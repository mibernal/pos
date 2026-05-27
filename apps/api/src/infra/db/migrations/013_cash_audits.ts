import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('cash_session_audits')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade')
    )
    .addColumn('cash_session_id', 'uuid', (col) =>
      col.notNull().references('cash_sessions.id').onDelete('cascade')
    )
    .addColumn('user_id', 'uuid', (col) => col.notNull()) // AUDITOR or MANAGER user_id
    .addColumn('observed_cash_cents', 'integer', (col) => col.notNull())
    .addColumn('expected_cash_cents', 'integer', (col) => col.notNull())
    .addColumn('diff_cents', 'integer', (col) => col.notNull())
    .addColumn('notes', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_cash_session_audits_session_id')
    .ifNotExists()
    .on('cash_session_audits')
    .columns(['tenant_id', 'cash_session_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('cash_session_audits').execute();
}
