import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // We need to drop the old foreign keys referencing users.id
  // and create new ones referencing waiters.id

  await db.schema
    .alterTable('tables')
    .dropConstraint('tables_waiter_id_fkey')
    .execute();

  await sql`UPDATE tables SET waiter_id = NULL`.execute(db);

  await db.schema
    .alterTable('tables')
    .addForeignKeyConstraint('tables_waiter_id_fkey', ['waiter_id'], 'waiters', ['id'])
    .onDelete('set null')
    .execute();

  await db.schema
    .alterTable('table_orders')
    .dropConstraint('table_orders_waiter_id_fkey')
    .execute();

  await sql`UPDATE table_orders SET waiter_id = NULL`.execute(db);

  await db.schema
    .alterTable('table_orders')
    .addForeignKeyConstraint('table_orders_waiter_id_fkey', ['waiter_id'], 'waiters', ['id'])
    .onDelete('set null')
    .execute();

  await db.schema
    .alterTable('sales')
    .dropConstraint('sales_waiter_id_fkey')
    .execute();

  await sql`UPDATE sales SET waiter_id = NULL`.execute(db);

  await db.schema
    .alterTable('sales')
    .addForeignKeyConstraint('sales_waiter_id_fkey', ['waiter_id'], 'waiters', ['id'])
    .onDelete('set null')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('sales')
    .dropConstraint('sales_waiter_id_fkey')
    .execute();

  await db.schema
    .alterTable('sales')
    .addForeignKeyConstraint('sales_waiter_id_fkey', ['waiter_id'], 'users', ['id'])
    .onDelete('set null')
    .execute();

  await db.schema
    .alterTable('table_orders')
    .dropConstraint('table_orders_waiter_id_fkey')
    .execute();

  await db.schema
    .alterTable('table_orders')
    .addForeignKeyConstraint('table_orders_waiter_id_fkey', ['waiter_id'], 'users', ['id'])
    .onDelete('set null')
    .execute();

  await db.schema
    .alterTable('tables')
    .dropConstraint('tables_waiter_id_fkey')
    .execute();

  await db.schema
    .alterTable('tables')
    .addForeignKeyConstraint('tables_waiter_id_fkey', ['waiter_id'], 'users', ['id'])
    .onDelete('set null')
    .execute();
}
