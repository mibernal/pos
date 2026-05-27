/**
 * C4: Scheduler de confirmación para documentos DIAN en estado SENT.
 *
 * PROBLEMA CRÍTICO detectado en auditoría:
 * Cuando el provider DIAN responde con status=SENT (en procesamiento),
 * el outbox se marca como SENT y no hay mecanismo de resolución.
 * El documento queda en SENT indefinidamente → contingencia fiscal.
 *
 * SOLUCIÓN:
 * Este scheduler busca documentos DIAN con status=SENT que tienen
 * más de DIAN_SENT_RECHECK_DELAY_MS sin actualización y los re-encola
 * en el outbox para que el worker los procese de nuevo.
 *
 * La lógica del processor ya sabe cómo manejar documentos en SENT:
 * - Si el provider responde ACCEPTED → transición SENT→ACCEPTED
 * - Si el provider responde REJECTED → transición SENT→REJECTED
 * - Si el provider falla → el outbox se reintenta con backoff
 */
import type { Queue } from 'bullmq';
import type { Pool } from 'pg';
import type { AnyOutboxJobData } from '../jobs/types.js';
import { logWorkerError, logWorkerInfo } from '../infra/logging/worker-log.js';

// Tiempo mínimo sin actualización antes de recheck (default: 10 minutos)
const DIAN_SENT_RECHECK_DELAY_MS = parseInt(
  process.env.DIAN_SENT_RECHECK_DELAY_MS ?? '600000',
  10
);

interface StuckDianDocumentRow {
  id: string;
  sale_id: string;
  tenant_id: string;
  document_type: string;
  updated_at: Date;
}

interface RecheckOutboxRow {
  id: string;
}

/**
 * Re-encola en el outbox los documentos DIAN que llevan más de
 * DIAN_SENT_RECHECK_DELAY_MS en estado SENT sin ser confirmados.
 *
 * Estrategia conservadora:
 * - Solo actúa si NO hay ya un outbox PENDING para esa venta y tipo.
 * - Inserta un nuevo outbox_event con payload de reconfirmación.
 * - El processor existente lo procesará en el siguiente ciclo.
 */
export async function recheckStuckDianDocuments(
  pool: Pool,
  queue: Queue<AnyOutboxJobData>,
  limit = 50
): Promise<number> {
  const recheckCutoff = new Date(Date.now() - DIAN_SENT_RECHECK_DELAY_MS);

  // Buscar documentos DIAN en SENT que no se han actualizado recientemente
  // y que NO tienen ya un outbox PENDING que los esté procesando
  const { rows: stuckDocs } = await pool.query<StuckDianDocumentRow>(
    `
      SELECT
        d.id,
        d.sale_id,
        d.tenant_id,
        d.document_type,
        d.updated_at
      FROM dian_documents d
      WHERE d.status = 'SENT'
        AND d.updated_at <= $1
        AND NOT EXISTS (
          SELECT 1 FROM outbox_events o
          WHERE o.tenant_id = d.tenant_id
            AND o.aggregate_id = d.sale_id
            AND o.type = CASE d.document_type
                           WHEN 'INVOICE' THEN 'SALE_CREATED'
                           WHEN 'CREDIT_NOTE' THEN 'SALE_VOIDED'
                         END
            AND o.status IN ('PENDING', 'FAILED')
            AND (o.next_retry_at IS NULL OR o.next_retry_at <= NOW())
        )
      ORDER BY d.updated_at ASC
      LIMIT $2
    `,
    [recheckCutoff, limit]
  );

  if (stuckDocs.length === 0) {
    return 0;
  }

  logWorkerInfo({
    event: 'dian_sent_recheck_found',
    message: `Encontrados ${stuckDocs.length} documentos DIAN en SENT sin confirmar`,
    details: {
      recheck_cutoff: recheckCutoff.toISOString(),
      count: stuckDocs.length
    }
  });

  let recheckCount = 0;

  for (const doc of stuckDocs) {
    try {
      const outboxType = doc.document_type === 'INVOICE' ? 'SALE_CREATED' : 'SALE_VOIDED';
      const jobName =
        outboxType === 'SALE_CREATED'
          ? 'process-sale-created-outbox-event'
          : 'process-sale-voided-outbox-event';

      // Insertar un nuevo evento de reconfirmación en el outbox
      const { rows: outboxRows } = await pool.query<RecheckOutboxRow>(
        `
          INSERT INTO outbox_events (
            id, tenant_id, type, aggregate_id, payload_json, status, attempts, next_retry_at
          )
          VALUES (
            gen_random_uuid(),
            $1,
            $2,
            $3,
            $4::jsonb,
            'PENDING',
            0,
            NULL
          )
          ON CONFLICT DO NOTHING
          RETURNING id
        `,
        [
          doc.tenant_id,
          outboxType,
          doc.sale_id,
          JSON.stringify({
            sale_id: doc.sale_id,
            tenant_id: doc.tenant_id,
            recheck: true,
            dian_document_id: doc.id,
            original_sent_at: doc.updated_at.toISOString()
          })
        ]
      );

      const outboxEventId = outboxRows[0]?.id;
      if (!outboxEventId) {
        // Ya existe un outbox para este evento, saltamos
        continue;
      }

      // Encolar en BullMQ para procesamiento inmediato
      await queue.add(
        jobName,
        { outboxEventId },
        {
          jobId: `dian-recheck-${doc.id}`,
          removeOnComplete: true,
          removeOnFail: false
        }
      );

      recheckCount += 1;

      logWorkerInfo({
        event: 'dian_sent_recheck_enqueued',
        message: 'Documento DIAN SENT re-encolado para confirmación',
        details: {
          dian_document_id: doc.id,
          sale_id: doc.sale_id,
          outbox_event_id: outboxEventId,
          document_type: doc.document_type,
          stuck_since: doc.updated_at.toISOString()
        }
      });
    } catch (error) {
      logWorkerError({
        event: 'dian_sent_recheck_failed',
        message: 'Error al re-encolar documento DIAN SENT',
        error,
        details: {
          dian_document_id: doc.id,
          sale_id: doc.sale_id
        }
      });
    }
  }

  return recheckCount;
}
