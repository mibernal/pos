import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Índice parcial para acelerar drásticamente el scheduler del worker
  // que busca eventos PENDING o FAILED para procesar.
  await sql`
    CREATE INDEX idx_outbox_events_scheduler 
    ON outbox_events (status, type, next_retry_at, created_at)
    WHERE status IN ('PENDING', 'FAILED')
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await sql`DROP INDEX IF EXISTS idx_outbox_events_scheduler`.execute(db);
}
