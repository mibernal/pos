import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('billing_plans')
    .addColumn('id', 'varchar(50)', (col) => col.primaryKey()) // e.g., 'STARTER', 'PRO', 'ENTERPRISE'
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('price_cents', 'integer', (col) => col.notNull())
    .addColumn('billing_cycle', 'varchar(20)', (col) => col.notNull().defaultTo('MONTHLY')) // MONTHLY, YEARLY
    .addColumn('features_json', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    .addColumn('active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db.schema
    .createTable('tenant_subscriptions')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('plan_id', 'varchar(50)', (col) => col.notNull().references('billing_plans.id'))
    .addColumn('status', 'varchar(50)', (col) => col.notNull()) // ACTIVE, PAST_DUE, CANCELED
    .addColumn('current_period_start', 'timestamp', (col) => col.notNull())
    .addColumn('current_period_end', 'timestamp', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db.schema
    .createTable('payment_transactions')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('amount_cents', 'integer', (col) => col.notNull())
    .addColumn('currency', 'varchar(3)', (col) => col.notNull().defaultTo('COP'))
    .addColumn('gateway', 'varchar(50)', (col) => col.notNull()) // WOMPI, MERCADOPAGO
    .addColumn('gateway_transaction_id', 'varchar(255)')
    .addColumn('gateway_reference', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('status', 'varchar(50)', (col) => col.notNull()) // PENDING, APPROVED, DECLINED, ERROR
    .addColumn('metadata_json', 'jsonb')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  // Insert base plans (precios de ejemplo en centavos: 49.900 COP = 4990000)
  await db.insertInto('billing_plans').values([
    { id: 'STARTER', name: 'Plan Starter', price_cents: 4990000, features_json: JSON.stringify({ users: 3, branches: 1 }) },
    { id: 'PRO', name: 'Plan Pro', price_cents: 9990000, features_json: JSON.stringify({ users: 10, branches: 3 }) },
    { id: 'ENTERPRISE', name: 'Plan Enterprise', price_cents: 19990000, features_json: JSON.stringify({ users: -1, branches: -1 }) }
  ]).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('payment_transactions').execute();
  await db.schema.dropTable('tenant_subscriptions').execute();
  await db.schema.dropTable('billing_plans').execute();
}
