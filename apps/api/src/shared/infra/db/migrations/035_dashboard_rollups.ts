import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Rollup de ventas diarias por sucursal
  await db.schema
    .createTable('daily_branch_sales_rollup')
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    .addColumn('date', 'date', (col) => col.notNull()) // Solo fecha YYYY-MM-DD
    .addColumn('total_revenue_cents', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('total_voids_cents', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('sales_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Primary key compuesta para permitir el upsert fácil
    .addPrimaryKeyConstraint('pk_daily_branch_sales', ['tenant_id', 'branch_id', 'date'])
    .execute();

  // Rollup de valorización de inventario diaria
  await db.schema
    .createTable('inventory_valuation_snapshot')
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('date', 'date', (col) => col.notNull())
    .addColumn('total_value_cents', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('pk_inventory_valuation', ['tenant_id', 'date'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('inventory_valuation_snapshot').execute();
  await db.schema.dropTable('daily_branch_sales_rollup').execute();
}
