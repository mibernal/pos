import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Add new enum values to inventory_operation_enum
  // Postgres requires these to be run outside a transaction block if using certain old versions,
  // but generally works in modern Postgres. We use IF NOT EXISTS just in case (PG 12+).
  const operations = [
    'PO_RECEIPT',
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'ADJUSTMENT_IN',
    'ADJUSTMENT_OUT',
    'CYCLE_COUNT'
  ];

  for (const op of operations) {
    await sql`ALTER TYPE inventory_operation_enum ADD VALUE IF NOT EXISTS ${sql.raw(`'${op}'`)}`.execute(db);
  }

  // 2. Suppliers
  await db.schema
    .createTable('suppliers')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('tax_id', 'text') // NIT/RUT
    .addColumn('email', 'text')
    .addColumn('phone', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    CREATE TRIGGER trg_suppliers_updated_at
    BEFORE UPDATE ON suppliers
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  await sql`CREATE INDEX idx_suppliers_tenant ON suppliers (tenant_id, name)`.execute(db);

  // 3. Purchase Orders
  await sql`CREATE TYPE po_status_enum AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'COMPLETED', 'CANCELED')`.execute(db);
  
  await db.schema
    .createTable('purchase_orders')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('restrict'))
    .addColumn('supplier_id', 'uuid', (col) => col.notNull().references('suppliers.id').onDelete('restrict'))
    .addColumn('status', sql`po_status_enum`, (col) => col.defaultTo('DRAFT').notNull())
    .addColumn('notes', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    CREATE TRIGGER trg_purchase_orders_updated_at
    BEFORE UPDATE ON purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  await db.schema
    .createTable('purchase_order_items')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('po_id', 'uuid', (col) => col.notNull().references('purchase_orders.id').onDelete('cascade'))
    .addColumn('product_id', 'uuid', (col) => col.notNull().references('products.id').onDelete('restrict'))
    .addColumn('expected_qty', 'numeric(12, 3)', (col) => col.notNull())
    .addColumn('cost_cents', 'integer', (col) => col.notNull())
    .execute();

  // 4. Inventory Receipts
  await sql`CREATE TYPE receipt_status_enum AS ENUM ('DRAFT', 'COMPLETED', 'CANCELED')`.execute(db);

  await db.schema
    .createTable('inventory_receipts')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('po_id', 'uuid', (col) => col.references('purchase_orders.id').onDelete('restrict'))
    .addColumn('received_by_user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('restrict'))
    .addColumn('status', sql`receipt_status_enum`, (col) => col.defaultTo('DRAFT').notNull())
    .addColumn('notes', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    CREATE TRIGGER trg_inventory_receipts_updated_at
    BEFORE UPDATE ON inventory_receipts
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  await db.schema
    .createTable('inventory_receipt_items')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('receipt_id', 'uuid', (col) => col.notNull().references('inventory_receipts.id').onDelete('cascade'))
    .addColumn('product_id', 'uuid', (col) => col.notNull().references('products.id').onDelete('restrict'))
    .addColumn('received_qty', 'numeric(12, 3)', (col) => col.notNull())
    .addColumn('cost_cents', 'integer', (col) => col.notNull())
    .execute();

  // 5. Inventory Transfers
  await sql`CREATE TYPE transfer_status_enum AS ENUM ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'REJECTED')`.execute(db);

  await db.schema
    .createTable('inventory_transfers')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('from_branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('restrict'))
    .addColumn('to_branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('restrict'))
    .addColumn('status', sql`transfer_status_enum`, (col) => col.defaultTo('DRAFT').notNull())
    .addColumn('shipped_at', 'timestamptz')
    .addColumn('received_at', 'timestamptz')
    .addColumn('notes', 'text')
    .addColumn('created_by_user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('restrict'))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    CREATE TRIGGER trg_inventory_transfers_updated_at
    BEFORE UPDATE ON inventory_transfers
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  await db.schema
    .createTable('inventory_transfer_items')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('transfer_id', 'uuid', (col) => col.notNull().references('inventory_transfers.id').onDelete('cascade'))
    .addColumn('product_id', 'uuid', (col) => col.notNull().references('products.id').onDelete('restrict'))
    .addColumn('shipped_qty', 'numeric(12, 3)', (col) => col.notNull())
    .addColumn('received_qty', 'numeric(12, 3)')
    .execute();

  // 6. Inventory Adjustments
  await sql`CREATE TYPE adjustment_status_enum AS ENUM ('DRAFT', 'COMPLETED', 'CANCELED')`.execute(db);

  await db.schema
    .createTable('inventory_adjustments')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('restrict'))
    .addColumn('reason', 'text', (col) => col.notNull()) // DAMAGE, THEFT, FOUND, EXPIRED, etc.
    .addColumn('notes', 'text')
    .addColumn('status', sql`adjustment_status_enum`, (col) => col.defaultTo('DRAFT').notNull())
    .addColumn('created_by_user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('restrict'))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    CREATE TRIGGER trg_inventory_adjustments_updated_at
    BEFORE UPDATE ON inventory_adjustments
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp()
  `.execute(db);

  await db.schema
    .createTable('inventory_adjustment_items')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('adjustment_id', 'uuid', (col) => col.notNull().references('inventory_adjustments.id').onDelete('cascade'))
    .addColumn('product_id', 'uuid', (col) => col.notNull().references('products.id').onDelete('restrict'))
    .addColumn('qty_change', 'numeric(12, 3)', (col) => col.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS inventory_adjustment_items`.execute(db);
  await sql`DROP TRIGGER IF EXISTS trg_inventory_adjustments_updated_at ON inventory_adjustments`.execute(db);
  await sql`DROP TABLE IF EXISTS inventory_adjustments`.execute(db);
  await sql`DROP TYPE IF EXISTS adjustment_status_enum`.execute(db);

  await sql`DROP TABLE IF EXISTS inventory_transfer_items`.execute(db);
  await sql`DROP TRIGGER IF EXISTS trg_inventory_transfers_updated_at ON inventory_transfers`.execute(db);
  await sql`DROP TABLE IF EXISTS inventory_transfers`.execute(db);
  await sql`DROP TYPE IF EXISTS transfer_status_enum`.execute(db);

  await sql`DROP TABLE IF EXISTS inventory_receipt_items`.execute(db);
  await sql`DROP TRIGGER IF EXISTS trg_inventory_receipts_updated_at ON inventory_receipts`.execute(db);
  await sql`DROP TABLE IF EXISTS inventory_receipts`.execute(db);
  await sql`DROP TYPE IF EXISTS receipt_status_enum`.execute(db);

  await sql`DROP TABLE IF EXISTS purchase_order_items`.execute(db);
  await sql`DROP TRIGGER IF EXISTS trg_purchase_orders_updated_at ON purchase_orders`.execute(db);
  await sql`DROP TABLE IF EXISTS purchase_orders`.execute(db);
  await sql`DROP TYPE IF EXISTS po_status_enum`.execute(db);

  await sql`DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON suppliers`.execute(db);
  await sql`DROP TABLE IF EXISTS suppliers`.execute(db);
}
