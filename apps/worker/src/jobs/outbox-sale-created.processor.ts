import type { Job } from 'bullmq';
import type { Pool } from 'pg';
import { env } from '../config/env.js';
import { computeNextRetryAt } from '../outbox/backoff.js';
import type { DianProvider } from '@pos-dian/shared/types/dian-provider.js';
import {
  formatDianStatusTransitions,
  getDianEmissionBlockReason,
  planDianStatusTransition
} from '../domain/dian-document-status.js';
import { type OutboxSaleCreatedJobData, saleCreatedPayloadSchema } from './types.js';
import { logWorkerError, logWorkerInfo } from '../infra/logging/worker-log.js';
import {
  buildIdempotencyKey,
  loadProviderPayload
} from './shared/dian-payload-builder.js';
import {
  claimOutboxEvent,
  getOrCreateDianDocument,
  markOutboxFailed,
  markOutboxSent,
  updateDianDocumentMetadata
} from './shared/outbox-store.js';

interface BuildOutboxSaleCreatedProcessorInput {
  pool: Pool;
  provider: DianProvider;
}

export function buildOutboxSaleCreatedProcessor({
  pool,
  provider
}: BuildOutboxSaleCreatedProcessorInput) {
  return async (job: Job<OutboxSaleCreatedJobData>): Promise<void> => {
    const claimWindowMs = Math.max(env.OUTBOX_POLL_INTERVAL_MS * 4, 30000);
    const claimedEvent = await claimOutboxEvent(pool, job.data.outboxEventId, claimWindowMs);
    if (!claimedEvent) {
      await job.log(`Outbox event ${job.data.outboxEventId} no está pendiente o ya fue tomado`);
      return;
    }

    const rawPayload = typeof claimedEvent.payload_json === 'string'
      ? JSON.parse(claimedEvent.payload_json)
      : claimedEvent.payload_json;
      
    const payload = saleCreatedPayloadSchema.parse(rawPayload);

    const saleId = claimedEvent.aggregate_id;
    const tenantId = claimedEvent.tenant_id;
    const nextAttemptNumber = claimedEvent.attempts + 1;
    const idempotencyKey = buildIdempotencyKey(payload, tenantId, saleId);

    const dianDocument = await getOrCreateDianDocument(pool, tenantId, saleId, 'INVOICE');

    logWorkerInfo({
      event: 'dian_outbox_job_started',
      message: 'Processing SALE_CREATED outbox event',
      job_id: job.id?.toString(),
      outbox_event_id: claimedEvent.id,
      sale_id: saleId,
      tenant_id: tenantId,
      attempt: nextAttemptNumber,
      dian_document_id: dianDocument.id,
      details: {
        current_dian_status: dianDocument.status
      }
    });

    const emissionBlockReason = getDianEmissionBlockReason(dianDocument.status, dianDocument.cude);
    if (emissionBlockReason) {
      await markOutboxSent(pool, claimedEvent.id, claimedEvent.attempts);
      logWorkerInfo({
        event: 'dian_outbox_job_skipped',
        message: 'Skipped DIAN emission due to idempotency guard',
        job_id: job.id?.toString(),
        outbox_event_id: claimedEvent.id,
        sale_id: saleId,
        tenant_id: tenantId,
        attempt: nextAttemptNumber,
        dian_document_id: dianDocument.id,
        provider_result: 'SKIPPED',
        reason: emissionBlockReason,
        details: {
          current_dian_status: dianDocument.status
        }
      });
      await job.log(
        `Outbox ${claimedEvent.id} omitido por idempotencia. document=${dianDocument.id} status=${dianDocument.status} reason=${emissionBlockReason}`
      );
      return;
    }

    let providerPayload;
    try {
      providerPayload = await loadProviderPayload(pool, tenantId, saleId, idempotencyKey);
    } catch (loadError) {
      const errorMsg = loadError instanceof Error ? loadError.message : 'Unknown load error';
      // Sale was deleted (e.g. DB reset/seed) — permanently dead-letter this event
      const isMissingEntity = errorMsg.includes('not found') || errorMsg.includes('Sale not found');
      if (isMissingEntity) {
        await pool.query(
          `UPDATE outbox_events
           SET status = 'FAILED',
               attempts = $2,
               next_retry_at = NOW() + INTERVAL '100 years',
               updated_at = NOW()
           WHERE id = $1`,
          [claimedEvent.id, nextAttemptNumber]
        );
        logWorkerError({
          event: 'dian_outbox_job_dead_lettered',
          message: 'Outbox event permanently failed: referenced entity no longer exists',
          job_id: job.id?.toString(),
          outbox_event_id: claimedEvent.id,
          sale_id: saleId,
          tenant_id: tenantId,
          attempt: nextAttemptNumber,
          error: loadError
        });
        await job.log(`Outbox ${claimedEvent.id} permanentemente fallido: ${errorMsg}`);
        return; // Do NOT re-throw — BullMQ won't retry a resolved job
      }
      throw loadError;
    }

    try {
      const providerResult = await provider.emitSale(providerPayload);
      const transitionPlan = planDianStatusTransition(dianDocument.status, providerResult.status);

      await updateDianDocumentMetadata(
        pool,
        dianDocument.id,
        providerPayload,
        providerResult.raw,
        transitionPlan.finalStatus,
        providerResult.cude
      );
      await markOutboxSent(pool, claimedEvent.id, nextAttemptNumber);
      logWorkerInfo({
        event: 'dian_outbox_job_succeeded',
        message: 'DIAN emission completed for sale',
        job_id: job.id?.toString(),
        outbox_event_id: claimedEvent.id,
        sale_id: saleId,
        tenant_id: tenantId,
        attempt: nextAttemptNumber,
        dian_document_id: dianDocument.id,
        dian_transition: formatDianStatusTransitions(transitionPlan.transitions),
        provider_result: providerResult.status,
        details: {
          final_dian_status: transitionPlan.finalStatus,
          cude: providerResult.cude ?? null
        }
      });
      await job.log(
        `Outbox ${claimedEvent.id} procesado. document=${dianDocument.id} provider_status=${providerResult.status} final_status=${transitionPlan.finalStatus} transitions=${formatDianStatusTransitions(transitionPlan.transitions)} cude=${providerResult.cude}`
      );
      return;
    } catch (error) {
      const nextRetryAt = computeNextRetryAt(
        nextAttemptNumber,
        new Date(),
        env.OUTBOX_RETRY_BASE_MS,
        env.OUTBOX_RETRY_MAX_MS
      );

      const errorPayload = {
        provider: env.DIAN_PROVIDER,
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      await updateDianDocumentMetadata(pool, dianDocument.id, providerPayload, errorPayload);
      await markOutboxFailed(pool, claimedEvent.id, nextAttemptNumber, nextRetryAt);
      logWorkerError({
        event: 'dian_outbox_job_failed',
        message: 'DIAN emission failed and will be retried',
        job_id: job.id?.toString(),
        outbox_event_id: claimedEvent.id,
        sale_id: saleId,
        tenant_id: tenantId,
        attempt: nextAttemptNumber,
        dian_document_id: dianDocument.id,
        dian_transition: `${dianDocument.status}->${dianDocument.status}`,
        provider_result: 'ERROR',
        next_retry_at: nextRetryAt.toISOString(),
        details: {
          current_dian_status: dianDocument.status,
          provider: env.DIAN_PROVIDER
        },
        error
      });
      await job.log(
        `Outbox ${claimedEvent.id} falló antes de completar transición DIAN. document=${dianDocument.id} current_status=${dianDocument.status} next_retry_at=${nextRetryAt.toISOString()} error=${errorPayload.error}`
      );

      throw error;
    }
  };
}
