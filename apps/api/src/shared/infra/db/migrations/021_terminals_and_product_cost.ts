import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Create terminals table
  await db.schema
    .createTable('terminals')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.defaultTo(true).notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addUniqueConstraint('uq_terminals_tenant_branch_name', ['tenant_id', 'branch_id', 'name'])
    .execute();

  await sql`
    CREATE TRIGGER trg_terminals_updated_at
    BEFORE UPDATE ON terminals
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  await db.schema
    .createIndex('idx_terminals_tenant_branch')
    .on('terminals')
    .columns(['tenant_id', 'branch_id'])
    .execute();

  // 2. Add terminal_id to cash_sessions
  await sql`
    ALTER TABLE cash_sessions
    ADD COLUMN terminal_id UUID NULL
  `.execute(db);

  await sql`
    ALTER TABLE cash_sessions
    ADD CONSTRAINT fk_cash_sessions_tenant_terminal
    FOREIGN KEY (tenant_id, terminal_id) REFERENCES terminals (tenant_id, id) ON DELETE RESTRICT
  `.execute(db);

  // 3. Migrate existing cash sessions by creating a default terminal per branch
  // For each distinct branch that has cash sessions, create a default terminal.
  // Then update cash_sessions to use that terminal.
  const branchesWithSessions = await sql<{ branch_id: string; tenant_id: string }>`
    SELECT DISTINCT branch_id, tenant_id FROM cash_sessions
  `.execute(db);

  for (const row of branchesWithSessions.rows) {
    const terminalId = crypto.randomUUID();
    await sql`
      INSERT INTO terminals (id, tenant_id, branch_id, name)
      VALUES (${terminalId}::uuid, ${row.tenant_id}::uuid, ${row.branch_id}::uuid, 'Caja Principal')
    `.execute(db);

    await sql`
      UPDATE cash_sessions
      SET terminal_id = ${terminalId}::uuid
      WHERE branch_id = ${row.branch_id}::uuid AND tenant_id = ${row.tenant_id}::uuid
    `.execute(db);
  }

  // 4. Enforce terminal_id constraint and modify unique index
  await sql`
    ALTER TABLE cash_sessions
    ALTER COLUMN terminal_id SET NOT NULL
  `.execute(db);

  // Drop old unique constraint
  await sql`DROP INDEX IF EXISTS uq_cash_sessions_one_open_per_branch`.execute(db);

  // Add new unique constraint per terminal instead of per branch
  await sql`
    CREATE UNIQUE INDEX uq_cash_sessions_one_open_per_terminal
    ON cash_sessions (tenant_id, terminal_id)
    WHERE closed_at IS NULL
  `.execute(db);

  // 5. Add cost_cents to products
  await sql`
    ALTER TABLE products
    ADD COLUMN cost_cents INTEGER NULL
  `.execute(db);

  // Initialize cost_cents to 0 for existing products
  await sql`
    UPDATE products SET cost_cents = 0 WHERE cost_cents IS NULL
  `.execute(db);

  await sql`
    ALTER TABLE products
    ALTER COLUMN cost_cents SET NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE products
    ADD CONSTRAINT ck_products_cost_cents_non_negative CHECK (cost_cents >= 0)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS ck_products_cost_cents_non_negative`.execute(db);
  await sql`ALTER TABLE products DROP COLUMN IF EXISTS cost_cents`.execute(db);

  await sql`DROP INDEX IF EXISTS uq_cash_sessions_one_open_per_terminal`.execute(db);
  
  await sql`
    CREATE UNIQUE INDEX uq_cash_sessions_one_open_per_branch
    ON cash_sessions (tenant_id, branch_id)
    WHERE closed_at IS NULL
  `.execute(db);

  await sql`ALTER TABLE cash_sessions DROP CONSTRAINT IF EXISTS fk_cash_sessions_tenant_terminal`.execute(db);
  await sql`ALTER TABLE cash_sessions DROP COLUMN IF EXISTS terminal_id`.execute(db);

  await sql`DROP TRIGGER IF EXISTS trg_terminals_updated_at ON terminals`.execute(db);
  await db.schema.dropTable('terminals').execute();
}
