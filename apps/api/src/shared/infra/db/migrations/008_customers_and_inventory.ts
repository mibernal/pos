import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TYPE inventory_operation_enum AS ENUM ('SALE', 'SALE_VOID', 'MANUAL_ENTRY', 'MANUAL_EXIT', 'PURCHASE')`.execute(db);

  await sql`
    CREATE TABLE customers (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      document_type VARCHAR(10) NOT NULL,
      document_number VARCHAR(32) NOT NULL,
      name TEXT NOT NULL,
      email TEXT NULL,
      phone TEXT NULL,
      address TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_customers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT ck_customers_doc_not_blank CHECK (char_length(trim(document_number)) > 0),
      CONSTRAINT ck_customers_name_not_blank CHECK (char_length(trim(name)) > 0),
      CONSTRAINT uq_customers_tenant_doc UNIQUE (tenant_id, document_type, document_number),
      CONSTRAINT uq_customers_tenant_id_pair UNIQUE (tenant_id, id)
    )
  `.execute(db);

  await sql`
    CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  await sql`
    ALTER TABLE sales
    ADD COLUMN customer_id UUID NULL
  `.execute(db);

  await sql`
    ALTER TABLE sales
    ADD CONSTRAINT fk_sales_tenant_customer
    FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE RESTRICT
  `.execute(db);

  await sql`
    CREATE TABLE inventory_balances (
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      product_id UUID NOT NULL,
      qty NUMERIC(12, 3) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, branch_id, product_id),
      CONSTRAINT fk_inv_balances_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT fk_inv_balances_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE RESTRICT,
      CONSTRAINT fk_inv_balances_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
    )
  `.execute(db);

  await sql`
    CREATE TRIGGER trg_inv_balances_updated_at
    BEFORE UPDATE ON inventory_balances
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  await sql`
    CREATE TABLE inventory_transactions (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      product_id UUID NOT NULL,
      operation inventory_operation_enum NOT NULL,
      reference_id UUID NULL,
      qty_change NUMERIC(12, 3) NOT NULL,
      notes TEXT NULL,
      created_by_user_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_inventory_tx_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT fk_inventory_tx_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_tx_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_tx_user FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT
    )
  `.execute(db);

  await sql`CREATE INDEX idx_customers_tenant_name ON customers (tenant_id, name)`.execute(db);
  await sql`CREATE INDEX idx_sales_tenant_customer ON sales (tenant_id, customer_id)`.execute(db);
  await sql`CREATE INDEX idx_inventory_tx_tenant_branch_product ON inventory_transactions (tenant_id, branch_id, product_id, created_at DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS inventory_transactions`.execute(db);
  await sql`DROP TABLE IF EXISTS inventory_balances`.execute(db);
  
  await sql`ALTER TABLE sales DROP CONSTRAINT IF EXISTS fk_sales_tenant_customer`.execute(db);
  await sql`ALTER TABLE sales DROP COLUMN IF EXISTS customer_id`.execute(db);
  
  await sql`DROP TABLE IF EXISTS customers`.execute(db);
  await sql`DROP TYPE IF EXISTS inventory_operation_enum`.execute(db);
}
