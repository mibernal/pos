import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Normalize historical SCREAMING_SNAKE_CASE outbox events to dot.case
  await sql`
    UPDATE outbox_events
    SET type = 'sale.created'
    WHERE type IN ('SALE_CREATED', 'sale_created')
  `.execute(db);

  await sql`
    UPDATE outbox_events
    SET type = 'sale.voided'
    WHERE type IN ('SALE_VOIDED', 'sale_voided')
  `.execute(db);

  await sql`
    UPDATE outbox_events
    SET type = 'sale.returned'
    WHERE type = 'sale_returned'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Irreversible since we don't know the original case of updated records
  await sql`SELECT 1`.execute(db);
}
