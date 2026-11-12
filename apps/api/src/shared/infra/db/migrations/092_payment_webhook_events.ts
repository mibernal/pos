import { Kysely, sql } from 'kysely';

/**
 * Migración 092 — Registro de los webhooks de pasarela recibidos.
 *
 * Las tres rutas de webhook capturaban cualquier excepción, la registraban en el log y
 * respondían **200 siempre**, con este comentario: «Retornamos 200 aunque falle la firma
 * para evitar reintentos infinitos maliciosos». El razonamiento es correcto para la firma
 * inválida y equivocado para todo lo demás: si la base falla mientras se procesa un pago
 * aprobado, la pasarela lo da por entregado, no reintenta, y el cobro se pierde. Como
 * tampoco quedaba constancia del evento, no había de dónde reconstruirlo — ni siquiera se
 * podía saber que había pasado.
 *
 * Con esta tabla, el cuerpo crudo se guarda **antes** de intentar nada, así que un fallo
 * posterior se puede reprocesar. El índice único sobre `(gateway, event_id)` hace que el
 * reintento legítimo de la pasarela sea idempotente sin depender del estado de la
 * transacción.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('payment_webhook_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('gateway', 'varchar(50)', (col) => col.notNull())
    // Id del evento en la pasarela. Es nulo cuando la pasarela no envía uno propio.
    .addColumn('event_id', 'varchar(255)')
    .addColumn('reference', 'varchar(255)')
    .addColumn('signature_valid', 'boolean', (col) => col.notNull())
    // RECEIVED · PROCESSED · IGNORED · REJECTED · FAILED
    .addColumn('status', 'varchar(30)', (col) => col.notNull().defaultTo('RECEIVED'))
    .addColumn('amount_cents', 'integer')
    .addColumn('payload_json', 'jsonb', (col) => col.notNull())
    .addColumn('error', 'text')
    .addColumn('received_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('processed_at', 'timestamp')
    .execute();

  // Idempotencia del reintento de la pasarela. Parcial porque `event_id` puede faltar.
  await sql`
    CREATE UNIQUE INDEX uq_payment_webhook_events_gateway_event
    ON payment_webhook_events (gateway, event_id)
    WHERE event_id IS NOT NULL
  `.execute(db);

  await db.schema
    .createIndex('idx_payment_webhook_events_reference')
    .on('payment_webhook_events')
    .columns(['reference'])
    .execute();

  // Para la consulta de vigilancia: qué llegó y no se pudo procesar.
  await sql`
    CREATE INDEX idx_payment_webhook_events_unresolved
    ON payment_webhook_events (received_at DESC)
    WHERE status IN ('FAILED', 'REJECTED')
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('payment_webhook_events').execute();
}
