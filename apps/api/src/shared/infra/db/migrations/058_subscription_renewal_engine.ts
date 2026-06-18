import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await db.schema
    .alterTable('tenant_subscriptions')
    .addColumn('retry_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_retries', 'integer', (col) => col.notNull().defaultTo(3))
    .addColumn('next_billing_at', 'timestamp')
    .addColumn('last_payment_attempt_at', 'timestamp')
    .addColumn('grace_period_days', 'integer', (col) => col.notNull().defaultTo(7))
    .addColumn('suspended_at', 'timestamp')
    .addColumn('cancelled_at', 'timestamp')
    .addColumn('cancellation_reason', 'text')
    .addColumn('payment_method_token', 'text')
    .addColumn('auto_renew', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();

  await db.schema
    .alterTable('payment_transactions')
    .addColumn('subscription_id', 'uuid', (col) => col.references('tenant_subscriptions.id').onDelete('set null'))
    .addColumn('attempt_number', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('idempotency_key', 'varchar(255)')
    .execute();

  await db.schema
    .alterTable('payment_transactions')
    .addUniqueConstraint('payment_transactions_idempotency_key_unique', ['idempotency_key'])
    .execute();

  // Create indexes for the scheduled jobs to quickly find eligible subscriptions
  // We can use raw SQL for conditional indexes if needed, but Kysely doesn't natively support partial indexes in createIndex cleanly without raw SQL expressions in some versions, so we use sql snippet or just full indexes.
  await db.schema
    .createIndex('idx_tenant_subs_next_billing')
    .on('tenant_subscriptions')
    .columns(['next_billing_at', 'status'])
    .execute();

  await db.schema
    .createIndex('idx_tenant_subs_trial_ends')
    .on('tenant_subscriptions')
    .columns(['trial_ends_at', 'status'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await db.schema.dropIndex('idx_tenant_subs_trial_ends').execute();
  await db.schema.dropIndex('idx_tenant_subs_next_billing').execute();

  await db.schema
    .alterTable('payment_transactions')
    .dropConstraint('payment_transactions_idempotency_key_unique')
    .execute();

  await db.schema
    .alterTable('payment_transactions')
    .dropColumn('idempotency_key')
    .dropColumn('attempt_number')
    .dropColumn('subscription_id')
    .execute();

  await db.schema
    .alterTable('tenant_subscriptions')
    .dropColumn('auto_renew')
    .dropColumn('payment_method_token')
    .dropColumn('cancellation_reason')
    .dropColumn('cancelled_at')
    .dropColumn('suspended_at')
    .dropColumn('grace_period_days')
    .dropColumn('last_payment_attempt_at')
    .dropColumn('next_billing_at')
    .dropColumn('max_retries')
    .dropColumn('retry_count')
    .execute();
}
