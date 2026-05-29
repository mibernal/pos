import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Índice para búsqueda de sesiones de caja activas por terminal
  await sql`
    CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant_terminal_status 
    ON cash_sessions (tenant_id, terminal_id, status)
  `.execute(db);

  // Índice para búsqueda de balances de inventario por sucursal y producto
  await sql`
    CREATE INDEX IF NOT EXISTS idx_inventory_balances_tenant_branch_product 
    ON inventory_balances (tenant_id, branch_id, product_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_inventory_balances_tenant_branch_product`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_cash_sessions_tenant_terminal_status`.execute(db);
}
