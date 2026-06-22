import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Agregar sent_to_kitchen_at a table_order_items
  await db.schema
    .alterTable('table_order_items')
    .addColumn('sent_to_kitchen_at', 'timestamp')
    .execute();

  // 2. Agregar preparation_station a products
  await db.schema
    .alterTable('products')
    .addColumn('preparation_station', 'varchar(50)', (col) => col.defaultTo('KITCHEN').notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('products')
    .dropColumn('preparation_station')
    .execute();

  await db.schema
    .alterTable('table_order_items')
    .dropColumn('sent_to_kitchen_at')
    .execute();
}
