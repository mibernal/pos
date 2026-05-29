import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('cash_movements')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
    .addColumn('cash_session_id', 'uuid', (col) => col.notNull().references('cash_sessions.id'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('type', 'varchar(10)', (col) => col.notNull()) // 'IN' or 'OUT'
    .addColumn('amount_cents', 'integer', (col) => col.notNull())
    .addColumn('reason', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_cash_movements_session')
    .ifNotExists()
    .on('cash_movements')
    .columns(['tenant_id', 'cash_session_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('cash_movements').execute();
}
