import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('sales')
    .addColumn('table_order_id', 'uuid', (col) => col.references('table_orders.id').onDelete('set null'))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('sales')
    .dropColumn('table_order_id')
    .execute();
}
