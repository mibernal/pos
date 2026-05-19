import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('promotions')
    .addColumn('id', 'uuid', (col) => col.primary())
    .addColumn('tenant_id', 'uuid', (col) => col.references('tenants.id').onDelete('cascade').notNull())
    .addColumn('product_id', 'uuid', (col) => col.references('products.id').onDelete('cascade').notNull())
    .addColumn('type', 'varchar', (col) => col.notNull()) // 'PERCENTAGE' | 'FIXED_AMOUNT' | 'BUY_X_GET_Y'
    .addColumn('value_cents', 'integer', (col) => col.notNull()) // 1000 = $10.00 or 1000 = 10.00%
    .addColumn('buy_qty', 'integer') // For buy X
    .addColumn('get_qty', 'integer') // get Y
    .addColumn('start_date', 'timestamp', (col) => col.notNull())
    .addColumn('end_date', 'timestamp')
    .addColumn('active', 'boolean', (col) => col.defaultTo(true).notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute();
    
  await db.schema
    .createIndex('promotions_tenant_product_idx')
    .on('promotions')
    .columns(['tenant_id', 'product_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('promotions').execute();
}
