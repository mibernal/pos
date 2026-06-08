import { sql, Kysely } from 'kysely';

/**
 * CRIT-001 — Extender Row Level Security a todas las tablas con tenant_id.
 *
 * La migración 038 solo activó RLS en `sales`. Esto deja al resto de tablas
 * críticas (productos, inventario, clientes, caja, DIAN, auditoría, alertas,
 * outbox) sin protección a nivel de base de datos.
 *
 * Cada tabla recibe:
 *   1. ENABLE ROW LEVEL SECURITY  — activa RLS en la tabla.
 *   2. FORCE ROW LEVEL SECURITY   — aplica la política incluso al owner de la tabla,
 *                                    así el usuario de conexión del worker/api tampoco
 *                                    puede bypassarla.
 *   3. CREATE POLICY               — permite acceso solo cuando
 *                                    tenant_id = current_setting('app.current_tenant', true).
 *                                    Si el parámetro no está seteado devuelve NULL,
 *                                    y NULL != cualquier UUID → acceso denegado por defecto.
 *
 * NOTA PARA EL WORKER: El worker usa conexiones raw pg.Pool sin executeAsTenant().
 * Sus queries usan siempre filtros explícitos WHERE tenant_id = $1, y trabaja
 * con un único tenant por job (leer el tenant_id desde outbox_events y propagarlo
 * a todas las queries). El worker NO usa RLS activo — sus queries pasan por
 * las políticas pero como su rol de DB es el owner (o un superuser en dev), RLS
 * puede no aplicar. En producción, el worker debe usar un rol distinto al owner
 * de las tablas para que FORCE ROW LEVEL SECURITY sea efectivo.
 *
 * TABLAS CUBIERTAS:
 *  - products, customers
 *  - inventory_balances, inventory_transactions, inventory_adjustments,
 *    inventory_adjustment_items, inventory_transfers, inventory_transfer_items,
 *    inventory_receipts, inventory_receipt_items, inventory_counts, inventory_count_items
 *  - cash_sessions, cash_movements, cash_reconciliations, cash_session_audits
 *  - dian_documents, outbox_events
 *  - sale_items, sale_returns, return_items
 *  - tenant_alerts, audit_logs
 *  - purchase_orders, purchase_order_items
 *  - user_branches, refresh_tokens
 *  - terminals, promotions, product_variants
 *  - daily_branch_sales_rollup, inventory_valuation_snapshot
 */

// Tablas que tienen columna tenant_id y necesitan RLS.
// No incluimos: tenants, branches, users (tablas de identidad sin tenant_id propio
// o cuyo tenant_id ES la PK — la política de tenants sería circular).
const TABLES_WITH_TENANT_ID = [
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
] as const;

// Tablas de auditoría: existen en múltiples particiones mensuales.
// La política se aplica a la tabla padre particionada; PostgreSQL la hereda.
const AUDIT_PARTITIONED_TABLES = [
  'audit_logs',
] as const;

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const table of TABLES_WITH_TENANT_ID) {
    await sql`ALTER TABLE ${sql.table(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`
      CREATE POLICY tenant_isolation_policy ON ${sql.table(table)}
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant', true))
    `.execute(db);
  }

  // Tabla particionada: aplicar a la tabla padre
  for (const table of AUDIT_PARTITIONED_TABLES) {
    await sql`ALTER TABLE ${sql.table(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`
      CREATE POLICY tenant_isolation_policy ON ${sql.table(table)}
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant', true))
    `.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const table of [...TABLES_WITH_TENANT_ID, ...AUDIT_PARTITIONED_TABLES]) {
    await sql`DROP POLICY IF EXISTS tenant_isolation_policy ON ${sql.table(table)}`.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} NO FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} DISABLE ROW LEVEL SECURITY`.execute(db);
  }
}
