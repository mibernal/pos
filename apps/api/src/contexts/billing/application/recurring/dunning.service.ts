import { randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { Database } from '../../../../shared/infra/db/schema.js';
import type { DunningEvent, DunningStep } from '@pos-dian/shared';

export interface RecordStepInput {
  tenantId: string;
  subscriptionId: string;
  invoiceId?: string | null;
  step: DunningStep;
  /** Periodo al que pertenece el paso. Junto con el intento, es la llave de idempotencia. */
  periodKey: string;
  attempt?: number;
  detail?: string | null;
  metadata?: Record<string, unknown> | null;
  notified?: boolean;
}

/**
 * El rastro de la cobranza.
 *
 * Existe por dos razones que se parecen poco entre sí:
 *
 * 1. **Para poder responder.** «¿Por qué está suspendido este comercio?» tenía como única
 *    respuesta leer los logs del worker, si es que seguían ahí. Ahora es una consulta, y
 *    la ve el propio comercio en su portal.
 * 2. **Para no repetir avisos.** El scheduler corre varias veces al día y no lleva memoria
 *    de lo que hizo la vez anterior. Sin esta tabla, el aviso de los siete días sale cada
 *    pasada hasta que llega el día del cobro. El índice único
 *    `(subscription_id, step, period_key, attempt)` lo convierte en una sola vez, y por eso
 *    `record` devuelve si el paso era nuevo: el correo se manda solo entonces.
 */
export class DunningService {
  /** `2026-09-01`. Identifica el periodo sin depender de la hora exacta del cobro. */
  static periodKey(date: Date | null | undefined): string {
    return (date ?? new Date()).toISOString().slice(0, 10);
  }

  /**
   * @returns `true` si el paso se registró ahora; `false` si ya existía. Quien llama usa
   *          ese booleano para decidir si envía el correo.
   */
  static async record(trx: Transaction<Database>, input: RecordStepInput): Promise<boolean> {
    const result = await trx
      .insertInto('dunning_events')
      .values({
        id: randomUUID(),
        tenant_id: input.tenantId,
        subscription_id: input.subscriptionId,
        invoice_id: input.invoiceId ?? null,
        step: input.step,
        period_key: input.periodKey,
        attempt: input.attempt ?? 0,
        notified: input.notified ?? false,
        detail: input.detail ?? null,
        metadata_json: (input.metadata ?? null) as never
      })
      .onConflict((oc) => oc.columns(['subscription_id', 'step', 'period_key', 'attempt']).doNothing())
      .executeTakeFirst();

    return Number(result.numInsertedOrUpdatedRows ?? 0) > 0;
  }

  static async trail(trx: Transaction<Database>, tenantId: string, limit = 30): Promise<DunningEvent[]> {
    const rows = await trx
      .selectFrom('dunning_events')
      .select(['id', 'step', 'attempt', 'detail', 'occurred_at'])
      .where('tenant_id', '=', tenantId)
      .orderBy('occurred_at', 'desc')
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      step: row.step as DunningStep,
      attempt: row.attempt,
      detail: row.detail,
      occurred_at: row.occurred_at.toISOString()
    }));
  }
}
