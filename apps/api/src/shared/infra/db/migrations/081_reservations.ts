import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('reservations')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id'))
    .addColumn('customer_id', 'uuid', (col) => col.references('customers.id'))
    .addColumn('customer_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('customer_phone', 'varchar(50)')
    .addColumn('table_id', 'uuid', (col) => col.references('tables.id'))
    .addColumn('reservation_date', 'timestamp', (col) => col.notNull())
    .addColumn('guests_count', 'integer', (col) => col.notNull().defaultTo(2))
    .addColumn('status', 'varchar(50)', (col) => col.notNull().defaultTo('PENDING'))
    .addColumn('notes', 'text')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db.schema
    .createIndex('reservations_tenant_branch_idx')
    .on('reservations')
    .columns(['tenant_id', 'branch_id', 'reservation_date'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('reservations').execute();
}
