import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE sales
    ADD COLUMN client_uuid UUID
  `.execute(db);

  await sql`
    UPDATE sales
    SET client_uuid = id
    WHERE client_uuid IS NULL
  `.execute(db);

  await sql`
    ALTER TABLE sales
    ALTER COLUMN client_uuid SET NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE sales
    ADD CONSTRAINT uq_sales_tenant_client_uuid UNIQUE (tenant_id, client_uuid)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE sales
    DROP CONSTRAINT IF EXISTS uq_sales_tenant_client_uuid
  `.execute(db);

  await sql`
    ALTER TABLE sales
    DROP COLUMN IF EXISTS client_uuid
  `.execute(db);
}
