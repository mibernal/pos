import { sql, type Kysely } from 'kysely';

/**
 * Migration 010 — Performance indexes + Stock guard config
 *
 * C5: Índice en sales.client_uuid para lookup de idempotencia eficiente
 * C8: Índice en dian_documents por sale_id + document_type
 * C3: Columna allow_negative_stock en tenants (default TRUE para compatibilidad)
 *     Cuando sea FALSE, la API bloqueará ventas que dejen stock negativo.
 * Perf: Índice en products activos por tenant + sucursal para el catálogo POS
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // C5: Idempotencia de venta — lookup frecuente en POST /sales
  await sql`
    CREATE INDEX IF NOT EXISTS idx_sales_tenant_client_uuid
    ON sales (tenant_id, client_uuid)
  `.execute(db);

  // C8: Detalle de venta con documento DIAN por tipo
  await sql`
    CREATE INDEX IF NOT EXISTS idx_dian_documents_tenant_sale_type
    ON dian_documents (tenant_id, sale_id, document_type)
  `.execute(db);

  // Perf: Catálogo activo por tenant + sucursal (carga del POS)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_products_tenant_branch_active
    ON products (tenant_id, branch_id, active)
    WHERE active = TRUE
  `.execute(db);

  // Perf: Customers por tenant + documento (búsqueda en checkout)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_customers_tenant_doc
    ON customers (tenant_id, document_type, document_number)
  `.execute(db);

  // C3: Campo de configuración de stock guard por tenant
  // Default TRUE = compatible con el comportamiento actual (permite negativo)
  // Cambiar a FALSE para activar el bloqueo estricto
  await sql`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT TRUE
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE tenants DROP COLUMN IF EXISTS allow_negative_stock`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_customers_tenant_doc`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_products_tenant_branch_active`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_dian_documents_tenant_sale_type`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_sales_tenant_client_uuid`.execute(db);
}
