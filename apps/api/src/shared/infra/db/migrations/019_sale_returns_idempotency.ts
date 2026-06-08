import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // C1: Add client_uuid to sale_returns
  await sql`
    ALTER TABLE sale_returns
    ADD COLUMN client_uuid UUID
  `.execute(db);

  // C2: Populate existing records with their own id as client_uuid to maintain unique constraint
  await sql`
    UPDATE sale_returns
    SET client_uuid = id
    WHERE client_uuid IS NULL
  `.execute(db);

  // C3: Make client_uuid NOT NULL
  await sql`
    ALTER TABLE sale_returns
    ALTER COLUMN client_uuid SET NOT NULL
  `.execute(db);

  // C4: Add Unique constraint for idempotency
  await sql`
    ALTER TABLE sale_returns
    ADD CONSTRAINT uq_sale_returns_tenant_client_uuid UNIQUE (tenant_id, client_uuid)
  `.execute(db);
  
  // C5: Add index for fast lookup
  await sql`
    CREATE INDEX IF NOT EXISTS idx_sale_returns_tenant_client_uuid 
    ON sale_returns (tenant_id, client_uuid)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await sql`DROP INDEX IF EXISTS idx_sale_returns_tenant_client_uuid`.execute(db);
  await sql`ALTER TABLE sale_returns DROP CONSTRAINT IF EXISTS uq_sale_returns_tenant_client_uuid`.execute(db);
  await sql`ALTER TABLE sale_returns DROP COLUMN IF EXISTS client_uuid`.execute(db);
}
