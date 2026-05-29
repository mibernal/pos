import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Add new columns for the Event Envelope
  await db.schema
    .alterTable('outbox_events')
    .addColumn('event_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('aggregate_type', 'varchar(50)', (col) => col.notNull().defaultTo('UNKNOWN'))
    .addColumn('branch_id', 'uuid', (col) => col.references('branches.id').onDelete('set null'))
    .addColumn('metadata_json', 'jsonb')
    .execute();

  // Update existing rows
  // We can infer some aggregate_types from the event type
  await sql`
    UPDATE outbox_events
    SET aggregate_type = CASE
      WHEN type LIKE 'sale.%' THEN 'SALE'
      WHEN type LIKE 'return.%' THEN 'RETURN'
      WHEN type LIKE 'inventory.%' THEN 'INVENTORY'
      WHEN type = 'LOW_STOCK_ALERT' THEN 'INVENTORY'
      ELSE 'UNKNOWN'
    END
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('outbox_events')
    .dropColumn('metadata_json')
    .dropColumn('branch_id')
    .dropColumn('aggregate_type')
    .dropColumn('event_version')
    .execute();
}
