import { sql, Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // We need to add branch_id to inventory_valuation_snapshot
  // Since it's a snapshot table, we truncate it first to avoid PK issues
  await sql`TRUNCATE TABLE inventory_valuation_snapshot`.execute(db);

  await sql`
    ALTER TABLE inventory_valuation_snapshot
    ADD COLUMN branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE
  `.execute(db);

  await sql`
    ALTER TABLE inventory_valuation_snapshot
    DROP CONSTRAINT pk_inventory_valuation
  `.execute(db);

  await sql`
    ALTER TABLE inventory_valuation_snapshot
    ADD CONSTRAINT pk_inventory_valuation PRIMARY KEY (tenant_id, branch_id, date)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await sql`TRUNCATE TABLE inventory_valuation_snapshot`.execute(db);
  
  await sql`
    ALTER TABLE inventory_valuation_snapshot
    DROP CONSTRAINT pk_inventory_valuation
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
