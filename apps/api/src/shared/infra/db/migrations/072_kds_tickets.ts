import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Create order_rounds table
  await db.schema
    .createTable('order_rounds')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    .addColumn('table_order_id', 'uuid', (col) => col.notNull().references('table_orders.id').onDelete('cascade'))
    .addColumn('waiter_id', 'uuid', (col) => col.references('waiters.id').onDelete('set null'))
    .addColumn('round_number', 'integer', (col) => col.notNull())
    .addColumn('status', 'varchar(50)', (col) => col.notNull().defaultTo('PENDING'))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_order_rounds_tenant_branch')
    .on('order_rounds')
    .columns(['tenant_id', 'branch_id'])
    .execute();

  // 2. Add columns to table_order_items
  await db.schema
    .alterTable('table_order_items')
    .addColumn('round_id', 'uuid', (col) => col.references('order_rounds.id').onDelete('set null'))
    .addColumn('seat_number', 'integer')
    .addColumn('item_status', 'varchar(50)', (col) => col.notNull().defaultTo('PENDING'))
    .addColumn('modifiers', 'jsonb')
    .execute();

  // 3. Create kitchen_tickets table
  await db.schema
    .createTable('kitchen_tickets')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    .addColumn('round_id', 'uuid', (col) => col.notNull().references('order_rounds.id').onDelete('cascade'))
    .addColumn('table_order_id', 'uuid', (col) => col.notNull().references('table_orders.id').onDelete('cascade'))
    .addColumn('status', 'varchar(50)', (col) => col.notNull().defaultTo('PENDING'))
    .addColumn('printed_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db.schema
    .createIndex('idx_kitchen_tickets_tenant_branch')
    .on('kitchen_tickets')
    .columns(['tenant_id', 'branch_id'])
    .execute();

  // 4. Create kitchen_ticket_items table
  await db.schema
    .createTable('kitchen_ticket_items')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    .addColumn('kitchen_ticket_id', 'uuid', (col) => col.notNull().references('kitchen_tickets.id').onDelete('cascade'))
    .addColumn('table_order_id', 'uuid', (col) => col.notNull().references('table_orders.id').onDelete('cascade'))
    .addColumn('product_id', 'uuid', (col) => col.notNull())
    .addColumn('variant_id', 'uuid')
    .addColumn('qty', 'integer', (col) => col.notNull())
    .addColumn('item_status', 'varchar(50)', (col) => col.notNull().defaultTo('PENDING'))
    .addColumn('notes', 'varchar(255)')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  // Enable RLS
  for (const table of ['order_rounds', 'kitchen_tickets', 'kitchen_ticket_items']) {
    await sql`ALTER TABLE ${sql.table(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`
      CREATE POLICY tenant_isolation_${sql.raw(table)} ON ${sql.table(table)}
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    `.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of ['order_rounds', 'kitchen_tickets', 'kitchen_ticket_items']) {
    await sql`DROP POLICY IF EXISTS tenant_isolation_${sql.raw(table)} ON ${sql.table(table)}`.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} DISABLE ROW LEVEL SECURITY`.execute(db);
  }

  await db.schema.dropTable('kitchen_ticket_items').execute();
  await db.schema.dropTable('kitchen_tickets').execute();

  await db.schema
    .alterTable('table_order_items')
    .dropColumn('round_id')
    .dropColumn('seat_number')
    .dropColumn('item_status')
    .dropColumn('modifiers')
    .execute();

  await db.schema.dropTable('order_rounds').execute();
}
