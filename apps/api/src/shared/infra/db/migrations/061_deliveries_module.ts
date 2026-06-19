import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE delivery_persons (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_delivery_persons_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT fk_delivery_persons_tenant_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) ON DELETE CASCADE,
      CONSTRAINT ck_delivery_persons_name_not_blank CHECK (char_length(trim(name)) > 0),
      CONSTRAINT ck_delivery_persons_phone_not_blank CHECK (char_length(trim(phone)) > 0),
      CONSTRAINT uq_delivery_persons_tenant_id_pair UNIQUE (tenant_id, id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE deliveries (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      sale_id UUID NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      delivery_address TEXT NOT NULL,
      delivery_neighborhood TEXT NULL,
      delivery_notes TEXT NULL,
      delivery_person_id UUID NULL,
      total_cents INTEGER NOT NULL,
      status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_deliveries_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT fk_deliveries_tenant_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) ON DELETE CASCADE,
      CONSTRAINT fk_deliveries_sale FOREIGN KEY (tenant_id, sale_id) REFERENCES sales (tenant_id, id) ON DELETE SET NULL,
      CONSTRAINT fk_deliveries_person FOREIGN KEY (tenant_id, delivery_person_id) REFERENCES delivery_persons (tenant_id, id) ON DELETE SET NULL,
      CONSTRAINT ck_deliveries_status CHECK (status IN ('PENDING', 'PREPARING', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED')),
      CONSTRAINT ck_deliveries_total_cents CHECK (total_cents >= 0),
      CONSTRAINT uq_deliveries_tenant_id_pair UNIQUE (tenant_id, id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE delivery_items (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      delivery_id UUID NOT NULL,
      product_id UUID NOT NULL,
      variant_id UUID NULL,
      qty NUMERIC(12, 3) NOT NULL,
      price_cents INTEGER NOT NULL,
      line_total_cents INTEGER NOT NULL,
      CONSTRAINT fk_delivery_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT fk_delivery_items_delivery FOREIGN KEY (tenant_id, delivery_id) REFERENCES deliveries (tenant_id, id) ON DELETE CASCADE,
      CONSTRAINT fk_delivery_items_product FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT ck_delivery_items_qty_positive CHECK (qty > 0),
      CONSTRAINT ck_delivery_items_price_non_negative CHECK (price_cents >= 0),
      CONSTRAINT ck_delivery_items_line_total_non_negative CHECK (line_total_cents >= 0)
    )
  `.execute(db);

  await sql`
    CREATE TRIGGER trg_delivery_persons_updated_at
    BEFORE UPDATE ON delivery_persons
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  await sql`
    CREATE TRIGGER trg_deliveries_updated_at
    BEFORE UPDATE ON deliveries
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  // Indexes
  await sql`CREATE INDEX idx_delivery_persons_tenant_branch ON delivery_persons (tenant_id, branch_id)`.execute(db);
  await sql`CREATE INDEX idx_deliveries_tenant_branch_status ON deliveries (tenant_id, branch_id, status)`.execute(db);
  await sql`CREATE INDEX idx_delivery_items_delivery_id ON delivery_items (delivery_id)`.execute(db);

  // RLS Policies
  await sql`ALTER TABLE delivery_persons ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE delivery_items ENABLE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY tenant_isolation_delivery_persons ON delivery_persons
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  `.execute(db);

  await sql`
    CREATE POLICY tenant_isolation_deliveries ON deliveries
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  `.execute(db);

  await sql`
    CREATE POLICY tenant_isolation_delivery_items ON delivery_items
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS delivery_items`.execute(db);
  await sql`DROP TABLE IF EXISTS deliveries`.execute(db);
  await sql`DROP TABLE IF EXISTS delivery_persons`.execute(db);
}
