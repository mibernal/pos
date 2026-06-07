import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE product_images (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      product_id UUID NOT NULL,
      storage_provider VARCHAR(50) NOT NULL,
      storage_key TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      size_bytes BIGINT NOT NULL,
      width INTEGER NULL,
      height INTEGER NULL,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_product_images_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT fk_product_images_tenant_product FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE CASCADE,
      CONSTRAINT ck_product_images_size_positive CHECK (size_bytes > 0),
      CONSTRAINT uq_product_images_tenant_id UNIQUE (tenant_id, id)
    )
  `.execute(db);

  await sql`
    CREATE TRIGGER trg_product_images_updated_at
    BEFORE UPDATE ON product_images
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  await sql`
    CREATE INDEX idx_product_images_tenant_product
    ON product_images (tenant_id, product_id, is_primary DESC, created_at ASC)
  `.execute(db);

  // Partial unique index to ensure only one primary image per product
  await sql`
    CREATE UNIQUE INDEX uq_product_images_one_primary
    ON product_images (tenant_id, product_id)
    WHERE is_primary = TRUE
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS product_images`.execute(db);
}
