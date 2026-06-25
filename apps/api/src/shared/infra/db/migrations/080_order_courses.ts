import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Add 'course' to table_order_items
  await db.schema
    .alterTable('table_order_items')
    .addColumn('course', 'integer', (col) => col.notNull().defaultTo(1))
    .execute();

  // Add 'course' to kitchen_tickets
  await db.schema
    .alterTable('kitchen_tickets')
    .addColumn('course', 'integer', (col) => col.notNull().defaultTo(1))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('kitchen_tickets')
    .dropColumn('course')
    .execute();

  await db.schema
    .alterTable('table_order_items')
    .dropColumn('course')
    .execute();
}
