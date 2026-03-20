import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE tenants
    ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'IVA'
  `.execute(db);

  await sql`
    ALTER TABLE tenants
    ADD CONSTRAINT ck_tenants_tax_mode
    CHECK (tax_mode IN ('IVA', 'INC_RESTAURANT'))
  `.execute(db);

  await sql`
    ALTER TABLE products
    ADD COLUMN tax_category TEXT NOT NULL DEFAULT 'IVA_19'
  `.execute(db);

  await sql`
    ALTER TABLE products
    ADD CONSTRAINT ck_products_tax_category
    CHECK (tax_category IN ('IVA_0', 'IVA_5', 'IVA_19', 'EXEMPT', 'EXCLUDED', 'INC_8'))
  `.execute(db);

  await sql`
    ALTER TABLE sales
    ADD COLUMN tax_total_cents INTEGER NOT NULL DEFAULT 0
  `.execute(db);

  await sql`
    ALTER TABLE sales
    ADD COLUMN tax_lines_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `.execute(db);

  await sql`
    ALTER TABLE sales
    ADD CONSTRAINT ck_sales_tax_total_non_negative CHECK (tax_total_cents >= 0)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE sales
    DROP CONSTRAINT IF EXISTS ck_sales_tax_total_non_negative
  `.execute(db);

  await sql`
    ALTER TABLE sales
    DROP COLUMN IF EXISTS tax_lines_json
  `.execute(db);

  await sql`
    ALTER TABLE sales
    DROP COLUMN IF EXISTS tax_total_cents
  `.execute(db);

  await sql`
    ALTER TABLE products
    DROP CONSTRAINT IF EXISTS ck_products_tax_category
  `.execute(db);

  await sql`
    ALTER TABLE products
    DROP COLUMN IF EXISTS tax_category
  `.execute(db);

  await sql`
    ALTER TABLE tenants
    DROP CONSTRAINT IF EXISTS ck_tenants_tax_mode
  `.execute(db);

  await sql`
    ALTER TABLE tenants
    DROP COLUMN IF EXISTS tax_mode
  `.execute(db);
}
