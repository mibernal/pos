import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // 1. Create inventory_counts table
  await db.schema
    .createTable('inventory_counts')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('status', 'varchar(50)', (col) => col.notNull().defaultTo('DRAFT')) // DRAFT, COUNTING, RECONCILING, COMPLETED, CANCELED
    .addColumn('started_by_user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('approved_by_user_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('completed_at', 'timestamp')
    .execute();

  // 2. Create inventory_count_items table
  await db.schema
    .createTable('inventory_count_items')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('count_id', 'uuid', (col) => col.notNull().references('inventory_counts.id').onDelete('cascade'))
    .addColumn('product_id', 'uuid', (col) => col.notNull().references('products.id'))
    .addColumn('variant_id', 'uuid', (col) => col.references('product_variants.id'))
    .addColumn('system_qty', 'numeric(15, 4)', (col) => col.notNull().defaultTo('0'))
    .addColumn('counted_qty', 'numeric(15, 4)', (col) => col.notNull().defaultTo('0'))
    .addColumn('diff_qty', 'numeric(15, 4)', (col) => col.notNull().defaultTo('0'))
    .execute();

  // Index for unique product/variant per count
  await db.schema
    .createIndex('idx_inv_count_items_unique')
    .on('inventory_count_items')
    .columns(['tenant_id', 'count_id', 'product_id'])
    .expression(sql`COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)`)
    .unique()
    .execute();

  // 3. Alter inventory_receipts
  await db.schema
    .alterTable('inventory_receipts')
    .addColumn('receipt_type', 'varchar(50)', (col) => col.notNull().defaultTo('PO_LINKED')) // PO_LINKED, BLIND
    .addColumn('discrepancy_approved_by_user_id', 'uuid', (col) => col.references('users.id'))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await db.schema
    .alterTable('inventory_receipts')
    .dropColumn('discrepancy_approved_by_user_id')
    .dropColumn('receipt_type')
    .execute();

  await db.schema.dropTable('inventory_count_items').execute();
  await db.schema.dropTable('inventory_counts').execute();
}
