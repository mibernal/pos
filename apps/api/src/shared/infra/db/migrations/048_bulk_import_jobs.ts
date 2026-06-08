import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await db.schema
    .createTable('bulk_import_jobs')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('file_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('status', 'varchar(50)', (col) => col.notNull().defaultTo('PENDING'))
    .addColumn('total_rows', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('valid_rows', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('invalid_rows', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('processed_rows', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('payload_json', 'jsonb')
    .addColumn('errors_json', 'jsonb')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('completed_at', 'timestamp')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await db.schema.dropTable('bulk_import_jobs').execute();
}
