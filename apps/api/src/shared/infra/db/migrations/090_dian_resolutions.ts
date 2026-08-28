import { Kysely, sql } from 'kysely';

/**
 * Migración 090 — Resoluciones de facturación y numeración fiscal.
 *
 * Hasta aquí, lo que se enviaba al PAC como número de documento era `sales.sale_number`:
 * un contador interno por comercio. Eso no es una factura electrónica válida en Colombia.
 * La DIAN autoriza una **resolución** con un prefijo y un rango numérico, con vigencia, y
 * cada documento tiene que llevar un número de ese rango, estrictamente consecutivo y
 * nunca repetido. El CUFE/CUDE se calcula sobre ese número.
 *
 * Consecuencias de no tenerlo, en orden de gravedad:
 *  - El PAC rechaza los documentos, o —peor— los acepta y el hueco aparece meses después
 *    en una revisión de la DIAN, cuando ya no hay forma de reconstruir la numeración.
 *  - Al agotarse el rango, el comercio deja de poder facturar sin previo aviso. Un viernes
 *    por la tarde, si nadie miraba.
 *
 * Esta migración añade:
 *  - `dian_resolutions`: una fila por resolución autorizada (prefijo, rango, vigencia).
 *  - `dian_documents.prefix` / `document_number` / `resolution_id`: el número asignado,
 *    persistido en el documento y único por comercio, para que un reintento reutilice el
 *    mismo número en vez de quemar otro.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('dian_resolutions')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    // Una resolución puede ser del comercio entero o de una sucursal concreta. NULL = todo
    // el comercio; es el caso habitual en un negocio de una sola sede.
    .addColumn('branch_id', 'uuid', (col) => col.references('branches.id').onDelete('cascade'))
    .addColumn('document_type', 'varchar(20)', (col) => col.notNull().defaultTo('INVOICE'))
    .addColumn('resolution_number', 'varchar(100)', (col) => col.notNull())
    .addColumn('resolution_date', 'date', (col) => col.notNull())
    .addColumn('prefix', 'varchar(10)', (col) => col.notNull())
    .addColumn('range_from', 'bigint', (col) => col.notNull())
    .addColumn('range_to', 'bigint', (col) => col.notNull())
    // Último número entregado. Arranca en `range_from - 1`: el primer documento se lleva
    // `range_from`.
    .addColumn('current_number', 'bigint', (col) => col.notNull())
    .addColumn('valid_from', 'date', (col) => col.notNull())
    .addColumn('valid_until', 'date', (col) => col.notNull())
    // Umbral de aviso: cuántos números libres deben quedar para empezar a alertar.
    .addColumn('alert_threshold', 'integer', (col) => col.notNull().defaultTo(500))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('technical_key', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('dian_resolutions_range_valid', sql`range_to >= range_from`)
    .addCheckConstraint(
      'dian_resolutions_current_within_range',
      sql`current_number >= range_from - 1 AND current_number <= range_to`
    )
    .addCheckConstraint('dian_resolutions_validity', sql`valid_until >= valid_from`)
    .execute();

  // Solo puede haber una resolución activa por comercio, sucursal y tipo de documento. Sin
  // esto, dos resoluciones activas producirían dos series de numeración en paralelo — que
  // es exactamente el desastre que esta migración existe para evitar.
  await sql`
    CREATE UNIQUE INDEX uq_dian_resolutions_active_scope
    ON dian_resolutions (tenant_id, document_type, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE is_active
  `.execute(db);

  await db.schema
    .createIndex('idx_dian_resolutions_tenant')
    .on('dian_resolutions')
    .columns(['tenant_id', 'document_type'])
    .execute();

  await sql`ALTER TABLE dian_resolutions ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`
    CREATE POLICY tenant_isolation_policy ON dian_resolutions
    FOR ALL
    USING (tenant_id::text = current_setting('app.current_tenant', true))
  `.execute(db);
  await sql`ALTER TABLE dian_resolutions FORCE ROW LEVEL SECURITY`.execute(db);

  await db.schema
    .alterTable('dian_documents')
    .addColumn('resolution_id', 'uuid', (col) => col.references('dian_resolutions.id').onDelete('restrict'))
    .addColumn('prefix', 'varchar(10)')
    .addColumn('document_number', 'bigint')
    .execute();

  // El número fiscal no se repite dentro de un comercio. Es la garantía que impide que un
  // reintento, una carrera entre dos workers o un despliegue a medias emitan dos documentos
  // con el mismo número: el segundo choca contra el índice en vez de llegar a la DIAN.
  await sql`
    CREATE UNIQUE INDEX uq_dian_documents_fiscal_number
    ON dian_documents (tenant_id, prefix, document_number)
    WHERE document_number IS NOT NULL
  `.execute(db);

  // Permisos para el rol de conexión de la API.
  //
  // El rol se crea si falta, igual que en las migraciones 057 y 089: `api_user` es un rol
  // *del clúster*, no de la base, así que restaurar un volcado en un servidor nuevo —o
  // recrear el contenedor de Postgres— deja el esquema intacto y los roles fuera.
  // `pg_dump` no exporta roles.
  //
  // Un `GRANT … TO api_user` sin esta guarda revienta la migración entera cuando el rol no
  // está, que es exactamente lo que pasó al desplegar esta migración por primera vez.
  //
  // Si tampoco se puede crear (el rol que migra no tiene CREATEROLE), se avisa con un
  // WARNING visible en la salida en vez de fallar: la tabla y su RLS quedan correctas, y
  // los permisos se reparan con `./infra/scripts/create-api-role.sh`. Se avisa fuerte
  // porque sin ese rol la API acaba conectándose con el dueño del esquema y el aislamiento
  // entre comercios deja de aplicarse (D-036).
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_user') THEN
        BEGIN
          CREATE ROLE api_user NOLOGIN;
          RAISE NOTICE 'Rol api_user creado por la migración 090.';
        EXCEPTION WHEN insufficient_privilege THEN
          RAISE WARNING 'No se pudo crear el rol api_user (falta CREATEROLE). La API no podrá conectarse sin BYPASSRLS hasta que se cree: ./infra/scripts/create-api-role.sh';
        END;
      END IF;

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON dian_resolutions TO api_user;
      END IF;
    END
    $$
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS uq_dian_documents_fiscal_number`.execute(db);
  await db.schema
    .alterTable('dian_documents')
    .dropColumn('document_number')
    .dropColumn('prefix')
    .dropColumn('resolution_id')
    .execute();
  await db.schema.dropTable('dian_resolutions').execute();
}
