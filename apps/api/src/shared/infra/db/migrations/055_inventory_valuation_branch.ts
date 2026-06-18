import { sql, Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Idempotency check: verify if branch_id already exists (in case it was executed under the old 042_ filename)
  const hasColumn = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name='inventory_valuation_snapshot' AND column_name='branch_id'
  `.execute(db).then((res: any) => res.rows.length > 0);

  if (hasColumn) {
    return; // Already executed, skip
  }

  // We need to add branch_id to inventory_valuation_snapshot
  // Since it's a snapshot table, we truncate it first to avoid PK issues
  await sql`TRUNCATE TABLE inventory_valuation_snapshot`.execute(db);

  await sql`
    ALTER TABLE inventory_valuation_snapshot
    ADD COLUMN branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE
  `.execute(db);

  await sql`
    ALTER TABLE inventory_valuation_snapshot
    DROP CONSTRAINT IF EXISTS pk_inventory_valuation
  `.execute(db);

  await sql`
    ALTER TABLE inventory_valuation_snapshot
    ADD CONSTRAINT pk_inventory_valuation PRIMARY KEY (tenant_id, branch_id, date)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const hasColumn = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name='inventory_valuation_snapshot' AND column_name='branch_id'
  `.execute(db).then((res: any) => res.rows.length > 0);

  if (!hasColumn) {
    return; // Already reverted or never applied
  }

  await sql`TRUNCATE TABLE inventory_valuation_snapshot`.execute(db);
  
  await sql`
    ALTER TABLE inventory_valuation_snapshot
    DROP CONSTRAINT IF EXISTS pk_inventory_valuation
  `.execute(db);

  await sql`
    ALTER TABLE inventory_valuation_snapshot
    DROP COLUMN branch_id
  `.execute(db);

  await sql`
    ALTER TABLE inventory_valuation_snapshot
    ADD CONSTRAINT pk_inventory_valuation PRIMARY KEY (tenant_id, date)
  `.execute(db);
}
