import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Add status to cash_sessions
  await sql`CREATE TYPE cash_session_status_enum AS ENUM ('OPEN', 'CLOSED', 'RECONCILED')`.execute(db);

  await sql`
    ALTER TABLE cash_sessions
    ADD COLUMN status cash_session_status_enum NULL
  `.execute(db);

  await sql`
    UPDATE cash_sessions
    SET status = CASE
      WHEN closed_at IS NULL THEN 'OPEN'::cash_session_status_enum
      ELSE 'CLOSED'::cash_session_status_enum
    END
  `.execute(db);

  await sql`
    ALTER TABLE cash_sessions
    ALTER COLUMN status SET NOT NULL
  `.execute(db);

  // 2. Cash Reconciliations table
  await db.schema
    .createTable('cash_reconciliations')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('cash_session_id', 'uuid', (col) => col.notNull().references('cash_sessions.id').onDelete('cascade'))
    .addColumn('reconciled_by_user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('restrict'))
    .addColumn('final_cash_cents', 'integer', (col) => col.notNull())
    .addColumn('system_expected_cents', 'integer', (col) => col.notNull())
    .addColumn('discrepancy_cents', 'integer', (col) => col.notNull())
    .addColumn('resolution_notes', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addUniqueConstraint('uq_cash_reconciliations_session', ['tenant_id', 'cash_session_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('cash_reconciliations').execute();

  await sql`ALTER TABLE cash_sessions DROP COLUMN IF EXISTS status`.execute(db);
  await sql`DROP TYPE IF EXISTS cash_session_status_enum`.execute(db);
}
