import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('tenant_alerts')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.references('branches.id').onDelete('cascade'))
    .addColumn('type', 'varchar(50)', (col) => col.notNull())
    .addColumn('severity', 'varchar(20)', (col) => col.notNull())
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('metadata', 'jsonb')
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('UNREAD'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('resolved_at', 'timestamptz')
    .addColumn('resolved_by_user_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .execute();

  await db.schema
    .createIndex('idx_tenant_alerts_tenant_branch')
    .on('tenant_alerts')
    .columns(['tenant_id', 'branch_id'])
    .execute();

  await db.schema
    .createIndex('idx_tenant_alerts_status')
    .on('tenant_alerts')
    .columns(['status'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('tenant_alerts').execute();
}
