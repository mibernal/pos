import { type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('tables')
    .addColumn('waiter_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .execute();

  await db.schema
    .alterTable('table_orders')
    .addColumn('waiter_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .execute();

  await db.schema
    .alterTable('sales')
    .addColumn('waiter_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('sales')
    .dropColumn('waiter_id')
    .execute();

  await db.schema
    .alterTable('table_orders')
    .dropColumn('waiter_id')
    .execute();

  await db.schema
    .alterTable('tables')
    .dropColumn('waiter_id')
    .execute();
}
