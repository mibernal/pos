import { Kysely } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('sales')
    .addColumn('tip_cents', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();

  await db.schema
    .alterTable('table_orders')
    .addColumn('tip_cents', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('table_orders')
    .dropColumn('tip_cents')
    .execute();

  await db.schema
    .alterTable('sales')
    .dropColumn('tip_cents')
    .execute();
}
