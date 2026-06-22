import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Create waiters table
  await db.schema
    .createTable('waiters')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('pin', 'varchar(20)')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_waiters_tenant_branch')
    .on('waiters')
    .columns(['tenant_id', 'branch_id'])
    .execute();

  // 2. Add columns to table_orders
  await db.schema
    .alterTable('table_orders')
    .addColumn('guests_count', 'integer')
    .addColumn('order_type', 'varchar(50)', (col) => col.notNull().defaultTo('DINE_IN'))
    .execute();

  // Enable RLS for waiters
  await sql`ALTER TABLE waiters ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`
    CREATE POLICY tenant_isolation_waiters ON waiters
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP POLICY IF EXISTS tenant_isolation_waiters ON waiters`.execute(db);
  await sql`ALTER TABLE waiters DISABLE ROW LEVEL SECURITY`.execute(db);
  
  await db.schema
    .alterTable('table_orders')
    .dropColumn('guests_count')
    .dropColumn('order_type')
    .execute();

  await db.schema.dropTable('waiters').execute();
}
