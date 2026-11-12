import { Kysely, sql } from 'kysely';

/**
 * Migración 105 — Cierre de lote de tarjeta.
 *
 * El código de aprobación se teclea a mano y nada lo concilia contra el lote del
 * adquirente. El resultado diario es conocido: el datáfono imprime su cierre, el cajero lo
 * compara a ojo con el reporte del POS, y cuando no cuadra —una venta anulada en el
 * datáfono y no en el sistema, un código mal digitado— la diferencia se descubre semanas
 * después, en la conciliación bancaria, cuando ya nadie recuerda el día.
 *
 * La integración directa con Redeban o Credibanco necesita una cuenta y credenciales del
 * comercio, así que no vive aquí. Lo que sí vive es el cierre de lote: se captura el total
 * que imprime el datáfono y el sistema dice al momento si coincide con lo que registró, y
 * en qué se diferencia. Es la mayor parte del valor sin depender de un tercero — y cuando
 * exista el conector, lo único que cambia es de dónde salen esas cifras.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('card_batches')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull())
    /** Nulo cuando el comercio tiene un solo datáfono y no lo distingue. */
    .addColumn('terminal_id', 'uuid')
    .addColumn('acquirer', 'varchar(40)', (col) => col.notNull())
    .addColumn('batch_date', 'date', (col) => col.notNull())
    /** Lo que imprime el datáfono al cerrar. */
    .addColumn('declared_total_cents', 'integer', (col) => col.notNull())
    .addColumn('declared_count', 'integer', (col) => col.notNull())
    /** Lo que el sistema registró en ese rango, congelado al conciliar. */
    .addColumn('system_total_cents', 'integer', (col) => col.notNull())
    .addColumn('system_count', 'integer', (col) => col.notNull())
    .addColumn('diff_cents', 'integer', (col) => col.notNull())
    // MATCHED · MISMATCHED
    .addColumn('status', 'varchar(20)', (col) => col.notNull())
    .addColumn('reconciled_by_user_id', 'uuid', (col) => col.notNull())
    .addColumn('notes', 'varchar(300)')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    ALTER TABLE card_batches
    ADD CONSTRAINT ck_card_batches_status CHECK (status IN ('MATCHED', 'MISMATCHED'))
  `.execute(db);

  /**
   * Un lote por adquirente, sucursal, terminal y día. Conciliar dos veces el mismo cierre
   * produciría dos verdades distintas sobre el mismo dinero.
   */
  await sql`
    CREATE UNIQUE INDEX uq_card_batches_day
    ON card_batches (tenant_id, branch_id, acquirer, batch_date, COALESCE(terminal_id, '00000000-0000-0000-0000-000000000000'::uuid))
  `.execute(db);

  await db.schema
    .createIndex('idx_card_batches_tenant_date')
    .on('card_batches')
    .columns(['tenant_id', 'batch_date'])
    .execute();

  await sql`ALTER TABLE card_batches ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE card_batches FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`
    CREATE POLICY tenant_isolation_policy ON card_batches
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('card_batches').execute();
}
