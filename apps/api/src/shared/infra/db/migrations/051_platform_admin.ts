import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // 1. platform_events table
  await db.schema
    .createTable('platform_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('tenant_id', 'uuid', (col) => col.references('tenants.id').onDelete('cascade'))
    .addColumn('type', 'varchar(100)', (col) => col.notNull())
    .addColumn('severity', 'varchar(20)', (col) => col.notNull().defaultTo('INFO')) // INFO, WARNING, CRITICAL
    .addColumn('actor_id', 'uuid') // The user who triggered it, if any
    .addColumn('actor_email', 'varchar(255)')
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  // Indexes for querying activity
  await db.schema
    .createIndex('platform_events_type_idx')
    .on('platform_events')
    .column('type')
    .execute();

  await db.schema
    .createIndex('platform_events_created_at_idx')
    .on('platform_events')
    .column('created_at')
    .execute();

  // 2. subscription_events table
  await db.schema
    .createTable('subscription_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('subscription_id', 'uuid', (col) => col.notNull().references('tenant_subscriptions.id').onDelete('cascade'))
    .addColumn('type', 'varchar(100)', (col) => col.notNull()) // CREATED, RENEWED, CANCELED, PAST_DUE
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  // 3. Add starts_at, expires_at, trial_ends_at to tenant_subscriptions
  // We'll map current_period_start to starts_at contextually but add the requested columns
  await db.schema
    .alterTable('tenant_subscriptions')
    .addColumn('starts_at', 'timestamp')
    .addColumn('expires_at', 'timestamp')
    .addColumn('trial_ends_at', 'timestamp')
    .execute();

  // Backfill existing ones: starts_at = current_period_start, expires_at = current_period_end
  await sql`UPDATE tenant_subscriptions SET starts_at = current_period_start, expires_at = current_period_end`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await db.schema
    .alterTable('tenant_subscriptions')
    .dropColumn('trial_ends_at')
    .dropColumn('expires_at')
    .dropColumn('starts_at')
    .execute();

  await db.schema.dropTable('subscription_events').execute();
  await db.schema.dropTable('platform_events').execute();
}
