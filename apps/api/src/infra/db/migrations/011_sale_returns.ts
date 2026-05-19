import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add SALE_RETURN to InventoryOperation enum
  await sql`ALTER TYPE inventory_operation ADD VALUE IF NOT EXISTS 'SALE_RETURN'`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS sale_returns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      created_by_user_id UUID NOT NULL REFERENCES users(id),
      total_refund_cents INTEGER NOT NULL CHECK (total_refund_cents >= 0),
      reason TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `.execute(db);

  // Add indexes
  await sql`
    CREATE INDEX IF NOT EXISTS idx_sale_returns_tenant_sale 
    ON sale_returns (tenant_id, sale_id)
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS return_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      return_id UUID NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES products(id),
      qty NUMERIC(10,3) NOT NULL CHECK (qty > 0),
      refund_cents INTEGER NOT NULL CHECK (refund_cents >= 0),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_return_items_tenant_return 
    ON return_items (tenant_id, return_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS return_items CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS sale_returns CASCADE`.execute(db);
  // Note: PostgreSQL does not support dropping enum values easily, so we leave SALE_RETURN in the enum.
}
