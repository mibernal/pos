import { Kysely, sql } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  // 1. Create rooms table
  await db.schema
    .createTable('rooms')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_rooms_tenant_branch')
    .on('rooms')
    .columns(['tenant_id', 'branch_id'])
    .execute();

  // 2. Create tables table
  await db.schema
    .createTable('tables')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    .addColumn('room_id', 'uuid', (col) => col.notNull().references('rooms.id').onDelete('cascade'))
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('capacity', 'integer', (col) => col.notNull().defaultTo(4))
    .addColumn('status', 'varchar(30)', (col) => col.notNull().defaultTo('AVAILABLE'))
    .addColumn('current_sale_id', 'uuid', (col) => col.references('sales.id').onDelete('set null'))
    .addColumn('status_updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_tables_tenant_branch')
    .on('tables')
    .columns(['tenant_id', 'branch_id'])
    .execute();

  await db.schema
    .createIndex('idx_tables_room')
    .on('tables')
    .column('room_id')
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('tables').execute();
  await db.schema.dropTable('rooms').execute();
}
