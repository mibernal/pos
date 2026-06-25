import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Add new macro-module boolean columns for tenant subscriptions
  await db.schema
    .alterTable('tenants')
    .addColumn('enable_restaurant', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_kds', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_inventory', 'boolean', (col) => col.defaultTo(true).notNull()) // base for pos
    .addColumn('enable_fiscal', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_loyalty', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_advanced_reports', 'boolean', (col) => col.defaultTo(false).notNull())
    .execute();

  // 2. Backfill macro-modules based on existing granular configurations
  await sql`
    UPDATE tenants
    SET 
      enable_restaurant = (enable_tables = true OR enable_waiters = true OR enable_split_bill = true OR enable_tips = true OR enable_qr_menu = true OR enable_order_rounds = true),
      enable_kds = (enable_kitchen = true OR enable_kitchen_display = true OR enable_kitchen_tickets = true OR enable_kitchen_printing = true)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('tenants')
    .dropColumn('enable_restaurant')
    .dropColumn('enable_kds')
    .dropColumn('enable_inventory')
    .dropColumn('enable_fiscal')
    .dropColumn('enable_loyalty')
    .dropColumn('enable_advanced_reports')
    .execute();
}
