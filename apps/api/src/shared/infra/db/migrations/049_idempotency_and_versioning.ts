import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // 1. Tabla de llaves de idempotencia
  await db.schema
    .createTable('idempotency_records')
    .addColumn('key', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull())
    .addColumn('user_id', 'uuid')
    .addColumn('path', 'varchar(255)', (col) => col.notNull())
    .addColumn('status_code', 'integer', (col) => col.notNull())
    .addColumn('response_body_json', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`NOW()`).notNull())
    .addColumn('expires_at', 'timestamp', (col) => col.notNull())
    .execute();

  // 2. Columna de version en inventory_balances
  await db.schema
    .alterTable('inventory_balances')
    .addColumn('version', 'integer', (col) => col.defaultTo(1).notNull())
    .execute();

  // 3. Crear índice único en ventas para `client_uuid` por `tenant_id`
  // Para prevenir ventas duplicadas desde terminales offline.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_tenant_client_uuid ON sales (tenant_id, client_uuid)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await sql`DROP INDEX IF EXISTS idx_sales_tenant_client_uuid`.execute(db);
  
  await db.schema
    .alterTable('inventory_balances')
    .dropColumn('version')
    .execute();
    
  await db.schema.dropTable('idempotency_records').execute();
}
