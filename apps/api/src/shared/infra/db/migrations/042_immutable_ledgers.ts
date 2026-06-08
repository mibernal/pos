import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // 1. Triggers de protección global (Append-Only)
  await sql`
    CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'CRITICAL: Mutating a ledger table is strictly prohibited for audit reasons. Only INSERTS are allowed.';
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db);

  // 2. Tablas Ledger

  // 2.1 Sales Ledger
  await db.schema
    .createType('sales_ledger_operation')
    .asEnum(['SALE_CREATION', 'SALE_VOID', 'SALE_RETURN'])
    .execute();

  await db.schema
    .createTable('sales_ledger')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
    .addColumn('sale_id', 'uuid', (col) => col.notNull().references('sales.id'))
    .addColumn('type', sql`sales_ledger_operation`, (col) => col.notNull())
    .addColumn('amount_cents', 'bigint', (col) => col.notNull())
    .addColumn('tax_amount_cents', 'bigint', (col) => col.notNull())
    .addColumn('sequence_number', 'bigint', (col) => col.notNull())
    .addColumn('previous_hash', 'varchar', (col) => col.notNull())
    .addColumn('hash', 'varchar', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_by_user_id', 'uuid', (col) => col.notNull())
    .execute();

  await sql`CREATE UNIQUE INDEX idx_sales_ledger_tenant_seq ON sales_ledger (tenant_id, sequence_number)`.execute(db);
  await sql`CREATE UNIQUE INDEX idx_sales_ledger_hash ON sales_ledger (hash)`.execute(db);
  await sql`CREATE TRIGGER trg_prevent_sales_ledger_mutation BEFORE UPDATE OR DELETE ON sales_ledger FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation()`.execute(db);

  // 2.2 Inventory Ledger
  await db.schema
    .createType('inventory_ledger_operation')
    .asEnum(['SALE_DISCHARGE', 'RESTOCK', 'VOID_RESTOCK', 'ADJUSTMENT'])
    .execute();

  await db.schema
    .createTable('inventory_ledger')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id'))
    .addColumn('product_id', 'uuid', (col) => col.notNull().references('products.id'))
    .addColumn('variant_id', 'uuid', (col) => col.references('product_variants.id'))
    .addColumn('operation_type', sql`inventory_ledger_operation`, (col) => col.notNull())
    .addColumn('qty_change', 'decimal(15, 4)', (col) => col.notNull())
    .addColumn('balance_after', 'decimal(15, 4)', (col) => col.notNull())
    .addColumn('reference_id', 'uuid', (col) => col.notNull())
    .addColumn('sequence_number', 'bigint', (col) => col.notNull())
    .addColumn('previous_hash', 'varchar', (col) => col.notNull())
    .addColumn('hash', 'varchar', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`CREATE UNIQUE INDEX idx_inventory_ledger_seq ON inventory_ledger (product_id, branch_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'), sequence_number)`.execute(db);
  await sql`CREATE UNIQUE INDEX idx_inventory_ledger_hash ON inventory_ledger (hash)`.execute(db);
  await sql`CREATE TRIGGER trg_prevent_inv_ledger_mutation BEFORE UPDATE OR DELETE ON inventory_ledger FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation()`.execute(db);

  // 2.3 Cash Ledger
  await db.schema
    .createType('cash_ledger_operation')
    .asEnum(['OPENING', 'CASH_SALE', 'CASH_REFUND', 'MANUAL_IN', 'MANUAL_OUT', 'CLOSING_DISCREPANCY'])
    .execute();

  await db.schema
    .createTable('cash_ledger')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id'))
    .addColumn('cash_session_id', 'uuid', (col) => col.notNull().references('cash_sessions.id'))
    .addColumn('terminal_id', 'uuid', (col) => col.notNull().references('terminals.id'))
    .addColumn('type', sql`cash_ledger_operation`, (col) => col.notNull())
    .addColumn('amount_cents', 'bigint', (col) => col.notNull())
    .addColumn('balance_after_cents', 'bigint', (col) => col.notNull())
    .addColumn('sequence_number', 'bigint', (col) => col.notNull())
    .addColumn('previous_hash', 'varchar', (col) => col.notNull())
    .addColumn('hash', 'varchar', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`CREATE UNIQUE INDEX idx_cash_ledger_seq ON cash_ledger (cash_session_id, sequence_number)`.execute(db);
  await sql`CREATE UNIQUE INDEX idx_cash_ledger_hash ON cash_ledger (hash)`.execute(db);
  await sql`CREATE TRIGGER trg_prevent_cash_ledger_mutation BEFORE UPDATE OR DELETE ON cash_ledger FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation()`.execute(db);

  // 3. Establecer Row Level Security (RLS)
  const tables = ['sales_ledger', 'inventory_ledger', 'cash_ledger'];
  for (const table of tables) {
    await sql`ALTER TABLE ${sql.table(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    
    await sql`
      CREATE POLICY tenant_isolation_policy ON ${sql.table(table)}
      FOR ALL
      USING (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid)
    `.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const tables = ['cash_ledger', 'inventory_ledger', 'sales_ledger'];
  for (const table of tables) {
    await db.schema.dropTable(table).execute();
  }

  await sql`DROP TYPE cash_ledger_operation`.execute(db);
  await sql`DROP TYPE inventory_ledger_operation`.execute(db);
  await sql`DROP TYPE sales_ledger_operation`.execute(db);
  await sql`DROP FUNCTION prevent_ledger_mutation`.execute(db);
}
