import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TYPE user_role_enum AS ENUM ('ADMIN', 'CASHIER')`.execute(db);
  await sql`CREATE TYPE sale_status_enum AS ENUM ('COMPLETED', 'VOID')`.execute(db);
  await sql`CREATE TYPE dian_document_status_enum AS ENUM ('PENDING', 'SENT', 'ACCEPTED', 'REJECTED')`.execute(db);
  await sql`CREATE TYPE outbox_status_enum AS ENUM ('PENDING', 'SENT', 'FAILED')`.execute(db);

  await sql`
    CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db);

  await sql`
    CREATE TABLE tenants (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      nit VARCHAR(32) NOT NULL,
      business_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ck_tenants_name_not_blank CHECK (char_length(trim(name)) > 0),
      CONSTRAINT ck_tenants_nit_not_blank CHECK (char_length(trim(nit)) > 0),
      CONSTRAINT ck_tenants_business_name_not_blank CHECK (char_length(trim(business_name)) > 0),
      CONSTRAINT uq_tenants_nit UNIQUE (nit)
    )
  `.execute(db);

  await sql`
    CREATE TABLE branches (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_branches_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT ck_branches_name_not_blank CHECK (char_length(trim(name)) > 0),
      CONSTRAINT ck_branches_address_not_blank CHECK (char_length(trim(address)) > 0),
      CONSTRAINT uq_branches_tenant_id_pair UNIQUE (tenant_id, id),
      CONSTRAINT uq_branches_tenant_name UNIQUE (tenant_id, name)
    )
  `.execute(db);

  await sql`
    CREATE TABLE users (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role user_role_enum NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT ck_users_email_not_blank CHECK (char_length(trim(email)) > 0),
      CONSTRAINT ck_users_password_hash_not_blank CHECK (char_length(trim(password_hash)) > 0),
      CONSTRAINT ck_users_name_not_blank CHECK (char_length(trim(name)) > 0),
      CONSTRAINT uq_users_tenant_id_pair UNIQUE (tenant_id, id),
      CONSTRAINT uq_users_tenant_email UNIQUE (tenant_id, email)
    )
  `.execute(db);

await sql`
  CREATE TABLE products (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    branch_id UUID NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    barcode TEXT NULL,
    price_cents INTEGER NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_products_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
    CONSTRAINT fk_products_branch
      FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE SET NULL,
    CONSTRAINT ck_products_name_not_blank CHECK (char_length(trim(name)) > 0),
    CONSTRAINT ck_products_category_not_blank CHECK (char_length(trim(category)) > 0),
    CONSTRAINT ck_products_barcode_not_blank CHECK (barcode IS NULL OR char_length(trim(barcode)) > 0),
    CONSTRAINT ck_products_price_cents_non_negative CHECK (price_cents >= 0),
    CONSTRAINT uq_products_tenant_id_pair UNIQUE (tenant_id, id)
  )
`.execute(db);

  await sql`
    CREATE TABLE cash_sessions (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      opened_by_user_id UUID NOT NULL,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      opening_amount_cents INTEGER NOT NULL,
      closed_at TIMESTAMPTZ NULL,
      closing_cash_real_cents INTEGER NULL,
      expected_cash_cents INTEGER NULL,
      diff_cents INTEGER NULL,
      CONSTRAINT fk_cash_sessions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT fk_cash_sessions_tenant_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT fk_cash_sessions_tenant_user FOREIGN KEY (tenant_id, opened_by_user_id) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT ck_cash_sessions_opening_amount_non_negative CHECK (opening_amount_cents >= 0),
      CONSTRAINT ck_cash_sessions_closing_cash_non_negative CHECK (closing_cash_real_cents IS NULL OR closing_cash_real_cents >= 0),
      CONSTRAINT ck_cash_sessions_expected_cash_non_negative CHECK (expected_cash_cents IS NULL OR expected_cash_cents >= 0),
      CONSTRAINT ck_cash_sessions_closed_after_opened CHECK (closed_at IS NULL OR closed_at >= opened_at),
      CONSTRAINT uq_cash_sessions_tenant_id_pair UNIQUE (tenant_id, id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE sales (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      cash_session_id UUID NOT NULL,
      sale_number BIGINT NOT NULL,
      status sale_status_enum NOT NULL,
      subtotal_cents INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL,
      payment_json JSONB NOT NULL,
      created_by_user_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_sales_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT fk_sales_tenant_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT fk_sales_tenant_cash_session FOREIGN KEY (tenant_id, cash_session_id) REFERENCES cash_sessions (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT fk_sales_tenant_user FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT ck_sales_sale_number_positive CHECK (sale_number > 0),
      CONSTRAINT ck_sales_subtotal_non_negative CHECK (subtotal_cents >= 0),
      CONSTRAINT ck_sales_discount_non_negative CHECK (discount_cents >= 0),
      CONSTRAINT ck_sales_total_non_negative CHECK (total_cents >= 0),
      CONSTRAINT ck_sales_discount_le_subtotal CHECK (discount_cents <= subtotal_cents),
      CONSTRAINT ck_sales_total_formula CHECK (total_cents = subtotal_cents - discount_cents),
      CONSTRAINT uq_sales_tenant_id_pair UNIQUE (tenant_id, id),
      CONSTRAINT uq_sales_tenant_branch_sale_number UNIQUE (tenant_id, branch_id, sale_number)
    )
  `.execute(db);

  await sql`
    CREATE TABLE sale_items (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      sale_id UUID NOT NULL,
      product_id UUID NOT NULL,
      qty NUMERIC(12, 3) NOT NULL,
      price_cents INTEGER NOT NULL,
      line_total_cents INTEGER NOT NULL,
      CONSTRAINT fk_sale_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT fk_sale_items_tenant_sale FOREIGN KEY (tenant_id, sale_id) REFERENCES sales (tenant_id, id) ON DELETE CASCADE,
      CONSTRAINT fk_sale_items_tenant_product FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT ck_sale_items_qty_positive CHECK (qty > 0),
      CONSTRAINT ck_sale_items_price_non_negative CHECK (price_cents >= 0),
      CONSTRAINT ck_sale_items_line_total_non_negative CHECK (line_total_cents >= 0)
    )
  `.execute(db);

  await sql`
    CREATE TABLE dian_documents (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      sale_id UUID NOT NULL,
      provider TEXT NOT NULL,
      status dian_document_status_enum NOT NULL DEFAULT 'PENDING',
      cude TEXT NULL,
      provider_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      provider_response_json JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_dian_documents_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT fk_dian_documents_tenant_sale FOREIGN KEY (tenant_id, sale_id) REFERENCES sales (tenant_id, id) ON DELETE CASCADE,
      CONSTRAINT ck_dian_documents_provider_not_blank CHECK (char_length(trim(provider)) > 0),
      CONSTRAINT uq_dian_documents_tenant_sale UNIQUE (tenant_id, sale_id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE outbox_events (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      type TEXT NOT NULL,
      aggregate_id UUID NOT NULL,
      payload_json JSONB NOT NULL,
      status outbox_status_enum NOT NULL DEFAULT 'PENDING',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_outbox_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT ck_outbox_events_type_not_blank CHECK (char_length(trim(type)) > 0),
      CONSTRAINT ck_outbox_events_attempts_non_negative CHECK (attempts >= 0),
      CONSTRAINT uq_outbox_events_tenant_id_pair UNIQUE (tenant_id, id)
    )
  `.execute(db);

  await sql`
    CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  await sql`
    CREATE TRIGGER trg_dian_documents_updated_at
    BEFORE UPDATE ON dian_documents
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  await sql`
    CREATE TRIGGER trg_outbox_events_updated_at
    BEFORE UPDATE ON outbox_events
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  await sql`CREATE INDEX idx_branches_tenant_id ON branches (tenant_id)`.execute(db);
  await sql`CREATE INDEX idx_users_tenant_active ON users (tenant_id, active)`.execute(db);

  await sql`
    CREATE INDEX idx_products_tenant_branch
    ON products (tenant_id, branch_id)
  `.execute(db);
  await sql`
    CREATE INDEX idx_products_tenant_category
    ON products (tenant_id, category)
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX uq_products_tenant_barcode_not_null
    ON products (tenant_id, barcode)
    WHERE barcode IS NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX idx_cash_sessions_tenant_branch_opened
    ON cash_sessions (tenant_id, branch_id, opened_at DESC)
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX uq_cash_sessions_one_open_per_branch
    ON cash_sessions (tenant_id, branch_id)
    WHERE closed_at IS NULL
  `.execute(db);

  await sql`
    CREATE INDEX idx_sales_tenant_branch_created
    ON sales (tenant_id, branch_id, created_at DESC)
  `.execute(db);
  await sql`
    CREATE INDEX idx_sales_tenant_cash_session
    ON sales (tenant_id, cash_session_id)
  `.execute(db);

  await sql`
    CREATE INDEX idx_sale_items_tenant_sale
    ON sale_items (tenant_id, sale_id)
  `.execute(db);

  await sql`
    CREATE INDEX idx_dian_documents_tenant_status
    ON dian_documents (tenant_id, status)
  `.execute(db);

  await sql`
    CREATE INDEX idx_outbox_events_tenant_status_retry
    ON outbox_events (tenant_id, status, next_retry_at)
  `.execute(db);
  await sql`
    CREATE INDEX idx_outbox_events_tenant_aggregate
    ON outbox_events (tenant_id, aggregate_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS outbox_events`.execute(db);
  await sql`DROP TABLE IF EXISTS dian_documents`.execute(db);
  await sql`DROP TABLE IF EXISTS sale_items`.execute(db);
  await sql`DROP TABLE IF EXISTS sales`.execute(db);
  await sql`DROP TABLE IF EXISTS cash_sessions`.execute(db);
  await sql`DROP TABLE IF EXISTS products`.execute(db);
  await sql`DROP TABLE IF EXISTS users`.execute(db);
  await sql`DROP TABLE IF EXISTS branches`.execute(db);
  await sql`DROP TABLE IF EXISTS tenants`.execute(db);

  await sql`DROP FUNCTION IF EXISTS set_updated_at_timestamp`.execute(db);

  await sql`DROP TYPE IF EXISTS outbox_status_enum`.execute(db);
  await sql`DROP TYPE IF EXISTS dian_document_status_enum`.execute(db);
  await sql`DROP TYPE IF EXISTS sale_status_enum`.execute(db);
  await sql`DROP TYPE IF EXISTS user_role_enum`.execute(db);
}
