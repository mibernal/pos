import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Index for cleaning up expired refresh tokens
  await db.schema
    .createIndex('refresh_tokens_expires_at_idx')
    .ifNotExists()
    .on('refresh_tokens')
    .columns(['expires_at'])
    .execute();

  // Index for cleaning up processed outbox events
  await db.schema
    .createIndex('outbox_events_status_created_idx')
    .ifNotExists()
    .on('outbox_events')
    .columns(['status', 'created_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('outbox_events_status_created_idx').ifExists().execute();
  await db.schema.dropIndex('refresh_tokens_expires_at_idx').ifExists().execute();
}
