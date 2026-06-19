import { Kysely, sql } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  // 1. Create table_orders table
  await db.schema
    .createTable('table_orders')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    .addColumn('table_id', 'uuid', (col) => col.notNull().references('tables.id').onDelete('cascade'))
    .addColumn('status', 'varchar(30)', (col) => col.notNull().defaultTo('OPEN'))
    .addColumn('subtotal_cents', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('discount_cents', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('total_cents', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_table_orders_tenant_branch')
    .on('table_orders')
    .columns(['tenant_id', 'branch_id'])
    .execute();

  await db.schema
    .createIndex('idx_table_orders_table')
    .on('table_orders')
    .column('table_id')
    .execute();

  // 2. Create table_order_items table
  await db.schema
    .createTable('table_order_items')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    .addColumn('table_order_id', 'uuid', (col) => col.notNull().references('table_orders.id').onDelete('cascade'))
    .addColumn('product_id', 'uuid', (col) => col.notNull().references('products.id').onDelete('cascade'))
    .addColumn('variant_id', 'uuid', (col) => col.references('product_variants.id').onDelete('set null'))
    .addColumn('qty', 'integer', (col) => col.notNull())
    .addColumn('price_cents', 'integer', (col) => col.notNull())
    .addColumn('line_total_cents', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_table_order_items_order')
    .on('table_order_items')
    .column('table_order_id')
    .execute();
    
  // 3. Drop current_sale_id from tables as we use table_orders now, and add current_order_id
  await db.schema
    .alterTable('tables')
    .dropColumn('current_sale_id')
    .execute();
    
  await db.schema
    .alterTable('tables')
    .addColumn('current_order_id', 'uuid', (col) => col.references('table_orders.id').onDelete('set null'))
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('tables')
    .dropColumn('current_order_id')
    .execute();
    
  await db.schema
    .alterTable('tables')
    .addColumn('current_sale_id', 'uuid', (col) => col.references('sales.id').onDelete('set null'))
    .execute();

  await db.schema.dropTable('table_order_items').execute();
  await db.schema.dropTable('table_orders').execute();
}
