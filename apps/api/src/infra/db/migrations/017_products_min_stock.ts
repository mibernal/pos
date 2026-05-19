import { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('products')
    .addColumn('min_stock_alert_qty', 'integer')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('products')
    .dropColumn('min_stock_alert_qty')
    .execute();
}
