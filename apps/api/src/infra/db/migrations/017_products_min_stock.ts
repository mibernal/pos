import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock_alert_qty integer`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('products')
    .dropColumn('min_stock_alert_qty')
    .execute();
}
