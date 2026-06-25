import { sql, Kysely } from 'kysely';

const TABLES_TO_REACTIVATE_RLS = [
  'products',
  'product_variants',
  'promotions',
  'customers',
  'inventory_balances',
  'inventory_transactions',
  'inventory_adjustments',
  'inventory_adjustment_items',
  'inventory_transfers',
  'inventory_transfer_items',
  'inventory_receipts',
  'inventory_receipt_items',
  'inventory_counts',
  'inventory_count_items',
  'cash_sessions',
  'cash_movements',
  'cash_reconciliations',
  'cash_session_audits',
  'dian_documents',
  'outbox_events',
  'sale_items',
  'sale_returns',
  'return_items',
  'tenant_alerts',
  'purchase_orders',
  'purchase_order_items',
  'user_branches',
  'terminals',
  'daily_branch_sales_rollup',
  'inventory_valuation_snapshot',
  'audit_logs',
  'sales',
  'sales_ledger',
  'inventory_ledger',
  'cash_ledger'
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  for (const table of TABLES_TO_REACTIVATE_RLS) {
    // 1. Asegurar que RLS esté habilitado en la tabla
    await sql`ALTER TABLE ${sql.table(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    
    // 2. Recrear la política que se borró en la migración 044
    // Usamos missing_ok=true (el true) para que no rompa las consultas de admin si bypassrls no está seteado
    await sql`
      CREATE POLICY tenant_isolation_policy ON ${sql.table(table)}
      AS RESTRICTIVE
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant', true))
    `.execute(db);

    // 3. (Opcional pero recomendado) Forzar RLS incluso para dueños de la tabla si no están conectándose como api_user
    // Esto asegura que pos (el owner) también respete RLS a menos que tenga bypassrls. 
    // Como el user 'pos' actual tiene bypassrls por ser superuser/owner, esto obliga a respetarlo si le quitamos bypassrls.
    await sql`ALTER TABLE ${sql.table(table)} FORCE ROW LEVEL SECURITY`.execute(db);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  for (const table of TABLES_TO_REACTIVATE_RLS) {
    await sql`DROP POLICY IF EXISTS tenant_isolation_policy ON ${sql.table(table)}`.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} NO FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} DISABLE ROW LEVEL SECURITY`.execute(db);
  }
}
