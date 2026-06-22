import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('tenant_module_audit_logs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('performed_by', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('module_name', 'varchar(100)', (col) => col.notNull())
    .addColumn('previous_state', 'boolean', (col) => col.notNull())
    .addColumn('new_state', 'boolean', (col) => col.notNull())
    .addColumn('reason', 'text', (col) => col.notNull())
    .addColumn('is_cascade', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('tenant_module_audit_logs_tenant_id_idx')
    .on('tenant_module_audit_logs')
    .column('tenant_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('tenant_module_audit_logs').execute();
}
