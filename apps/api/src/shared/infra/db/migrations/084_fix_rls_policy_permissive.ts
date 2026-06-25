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
    // 1. Drop restrictive policy from 082
    await sql`DROP POLICY IF EXISTS tenant_isolation_policy ON ${sql.table(table)}`.execute(db);
    
    // 2. Recreate as PERMISSIVE (default). Restrictive policies without permissive ones deny all access.
    await sql`
      CREATE POLICY tenant_isolation_policy ON ${sql.table(table)}
      AS PERMISSIVE
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant', true))
    `.execute(db);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  for (const table of TABLES_TO_REACTIVATE_RLS) {
    await sql`DROP POLICY IF EXISTS tenant_isolation_policy ON ${sql.table(table)}`.execute(db);
    
    await sql`
      CREATE POLICY tenant_isolation_policy ON ${sql.table(table)}
      AS RESTRICTIVE
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant', true))
    `.execute(db);
  }
}
