import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Enable RLS
  await sql`ALTER TABLE table_orders ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE table_order_items ENABLE ROW LEVEL SECURITY`.execute(db);

  // Policies for table_orders
  await sql`
    CREATE POLICY tenant_isolation_table_orders ON table_orders
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  `.execute(db);

  // Policies for table_order_items
  await sql`
    CREATE POLICY tenant_isolation_table_order_items ON table_order_items
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP POLICY IF EXISTS tenant_isolation_table_orders ON table_orders`.execute(db);
  await sql`DROP POLICY IF EXISTS tenant_isolation_table_order_items ON table_order_items`.execute(db);

  await sql`ALTER TABLE table_orders DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE table_order_items DISABLE ROW LEVEL SECURITY`.execute(db);
}
