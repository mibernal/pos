import { Kysely, sql } from 'kysely';

/**
 * Migración 110 — Dónde vive el token del QR.
 *
 * La 109 lo puso en `tables`, y ahí no puede estar: `tables` tiene RLS forzado y el API se
 * conecta con un rol sin BYPASSRLS, así que para leer la fila hay que saber ya de qué
 * comercio es. Y lo único que trae la petición del comensal es el token. La pescadilla.
 *
 * Se resuelve con una tabla cuyo único trabajo es responder «este token es de este
 * comercio». No lleva RLS **a propósito**, y por eso no lleva nada más que identificadores:
 * ni nombres, ni precios, ni nada que revele algo del negocio a quien pruebe tokens al azar.
 * Con un valor aleatorio de 32 bytes, probar no lleva a ninguna parte.
 *
 * La alternativa —meter el `tenant_id` dentro del token y fijar con él el contexto de RLS—
 * se descartó: dejar que una petición anónima elija el comercio bajo el que corre una
 * transacción es una frase que no debería existir en este código, por muy validado que venga
 * después.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('qr_table_tokens')
    .addColumn('token', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    /** Una mesa, un código vivo: emitir uno nuevo reemplaza al anterior. */
    .addColumn('table_id', 'uuid', (col) => col.notNull().unique().references('tables.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    COMMENT ON TABLE qr_table_tokens IS
    'Sin RLS a propósito: resuelve el comercio de un token de QR antes de que exista contexto de tenant. Solo identificadores.'
  `.execute(db);

  // La 109 la dejó en `tables`, donde no se puede leer sin contexto de tenant.
  await sql`DROP INDEX IF EXISTS uq_tables_qr_token`.execute(db);
  await db.schema.alterTable('tables').dropColumn('qr_token').execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('tables').addColumn('qr_token', 'varchar(64)').execute();
  await sql`
    CREATE UNIQUE INDEX uq_tables_qr_token ON tables (qr_token) WHERE qr_token IS NOT NULL
  `.execute(db);
  await db.schema.dropTable('qr_table_tokens').execute();
}
