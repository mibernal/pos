import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Add boolean columns for tenant modules
  await db.schema
    .alterTable('tenants')
    .addColumn('enable_delivery', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_waiters', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_split_bill', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_tips', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_kitchen', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_kitchen_display', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_kitchen_tickets', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_kitchen_printing', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_order_rounds', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_product_modifiers', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_reservations', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_waiter_shifts', 'boolean', (col) => col.defaultTo(false).notNull())
    .addColumn('enable_qr_menu', 'boolean', (col) => col.defaultTo(false).notNull())
    .execute();

  // 2. Backfill: Enable core restaurant modules for existing Table Native Types
  await sql`
    UPDATE tenants
    SET 
      enable_tables = true,
      enable_delivery = true,
      enable_waiters = true,
      enable_split_bill = true,
      enable_tips = true,
      enable_kitchen = true,
      enable_kitchen_tickets = true
    WHERE business_type IN ('RESTAURANT', 'CAFETERIA', 'BAR', 'NIGHTCLUB')
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('tenants')
    .dropColumn('enable_delivery')
    .dropColumn('enable_waiters')
    .dropColumn('enable_split_bill')
    .dropColumn('enable_tips')
    .dropColumn('enable_kitchen')
    .dropColumn('enable_kitchen_display')
    .dropColumn('enable_kitchen_tickets')
    .dropColumn('enable_kitchen_printing')
    .dropColumn('enable_order_rounds')
    .dropColumn('enable_product_modifiers')
    .dropColumn('enable_reservations')
    .dropColumn('enable_waiter_shifts')
    .dropColumn('enable_qr_menu')
    .execute();
}
