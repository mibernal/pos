import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Add notes to table_order_items
  await db.schema.alterTable('table_order_items')
    .addColumn('notes', 'varchar(255)')
    .execute();

  // Add notes to sale_items
  await db.schema.alterTable('sale_items')
    .addColumn('notes', 'varchar(255)')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('table_order_items')
    .dropColumn('notes')
    .execute();

  await db.schema.alterTable('sale_items')
    .dropColumn('notes')
    .execute();
}
