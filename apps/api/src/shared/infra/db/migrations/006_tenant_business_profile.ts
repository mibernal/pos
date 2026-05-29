import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS address TEXT
  `.execute(db);

  await sql`
    UPDATE tenants AS t
    SET address = COALESCE(
      (
        SELECT b.address
        FROM branches AS b
        WHERE b.tenant_id = t.id
        ORDER BY b.created_at ASC, b.id ASC
        LIMIT 1
      ),
      'Dirección no configurada'
    )
    WHERE address IS NULL
  `.execute(db);

  await sql`
    ALTER TABLE tenants
    ALTER COLUMN address SET DEFAULT 'Dirección no configurada'
  `.execute(db);

  await sql`
    ALTER TABLE tenants
    ALTER COLUMN address SET NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS phone TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS footer_message TEXT NULL
  `.execute(db);

  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_address_not_blank') THEN
        ALTER TABLE tenants
        ADD CONSTRAINT ck_tenants_address_not_blank
        CHECK (char_length(trim(address)) > 0);
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE tenants
    DROP CONSTRAINT IF EXISTS ck_tenants_address_not_blank
  `.execute(db);

  await sql`
    ALTER TABLE tenants
    DROP COLUMN IF EXISTS footer_message
  `.execute(db);

  await sql`
    ALTER TABLE tenants
    DROP COLUMN IF EXISTS phone
  `.execute(db);

  await sql`
    ALTER TABLE tenants
    DROP COLUMN IF EXISTS address
  `.execute(db);
}
