import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Normalize data first to prevent constraint violations
  await sql`
    UPDATE tenants
    SET tax_mode = UPPER(TRIM(tax_mode))
    WHERE tax_mode IS NOT NULL;
  `.execute(db);

  await sql`
    UPDATE tenants
    SET tax_mode = 'IVA'
    WHERE tax_mode NOT IN ('IVA', 'INC_RESTAURANT') OR tax_mode IS NULL;
  `.execute(db);

  // Drop existing constraint if it exists (ignoring errors if not)
  await sql`
    ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ck_tenants_tax_mode;
  `.execute(db);

  // Re-add constraint
  await sql`
    ALTER TABLE tenants
    ADD CONSTRAINT ck_tenants_tax_mode
    CHECK (tax_mode IN ('IVA', 'INC_RESTAURANT'));
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ck_tenants_tax_mode;
  `.execute(db);
}
