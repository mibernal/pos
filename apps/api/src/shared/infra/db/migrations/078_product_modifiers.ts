import { Kysely, sql } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  // 1. Create product_modifier_groups table
  await db.schema
    .createTable('product_modifier_groups')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('product_id', 'uuid', (col) => col.notNull().references('products.id').onDelete('cascade'))
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('is_required', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('min_selections', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_selections', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_product_modifier_groups_tenant_product')
    .on('product_modifier_groups')
    .columns(['tenant_id', 'product_id'])
    .execute();

  // 2. Create product_modifier_options table
  await db.schema
    .createTable('product_modifier_options')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('group_id', 'uuid', (col) => col.notNull().references('product_modifier_groups.id').onDelete('cascade'))
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('extra_price_cents', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_product_modifier_options_group')
    .on('product_modifier_options')
    .column('group_id')
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('product_modifier_options').execute();
  await db.schema.dropTable('product_modifier_groups').execute();
}
