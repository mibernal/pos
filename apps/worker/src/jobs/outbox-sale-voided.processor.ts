import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import type { Pool } from 'pg';
import { env } from '../config/env.js';
import { computeNextRetryAt } from '../outbox/backoff.js';
import type { DianProvider } from '@pos-dian/shared/types/dian-provider.js';
import type { DianStatus } from '@pos-dian/shared';
import {
  formatDianStatusTransitions,
  getDianEmissionBlockReason,
  planDianStatusTransition
} from '../domain/dian-document-status.js';
import { type OutboxSaleVoidedJobData, saleVoidedPayloadSchema } from './types.js';
import { logWorkerError, logWorkerInfo } from '../infra/logging/worker-log.js';
import {
  buildIdempotencyKey,
  loadProviderPayload
} from './shared/dian-payload-builder.js';
import {
  claimOutboxEvent,
  markOutboxFailed,
  markOutboxSent,
  updateDianDocumentMetadata
} from './shared/outbox-store.js';

interface BuildOutboxSaleVoidedProcessorInput {
  pool: Pool;
  provider: DianProvider;
}

interface VoidedDianDocumentRow {
  id: string;
  status: DianStatus;
  cude: string | null;
}


async function getInvoiceDianDocument(
  pool: Pool,
  tenantId: string,
  saleId: string
): Promise<VoidedDianDocumentRow | null> {
  const found = await pool.query<VoidedDianDocumentRow>(
    `
      SELECT id, status, cude
      FROM dian_documents
      WHERE tenant_id = $1
        AND sale_id = $2
        AND document_type = 'INVOICE'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, saleId]
  );
  return found.rows[0] ?? null;
}

async function getOrCreateCreditNoteDianDocument(
  pool: Pool,
  tenantId: string,
  saleId: string,
  invoiceDocumentId: string
): Promise<VoidedDianDocumentRow> {
  const found = await pool.query<VoidedDianDocumentRow>(
    `
      SELECT id, status, cude
      FROM dian_documents
      WHERE tenant_id = $1
        AND sale_id = $2
        AND document_type = 'CREDIT_NOTE'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, saleId]
  );

  const existing = found.rows[0];
  if (existing) {
    return existing;
  }

  const inserted = await pool.query<VoidedDianDocumentRow>(
    `
      INSERT INTO dian_documents (
        id,
        tenant_id,
        sale_id,
        document_type,
        parent_document_id,
        provider,
        status,
        cude,
        provider_payload_json,
        provider_response_json
      )
      VALUES ($1, $2, $3, 'CREDIT_NOTE', $4, $5, 'PENDING', NULL, '{}'::jsonb, NULL)
      RETURNING id, status, cude
    `,
    [randomUUID(), tenantId, saleId, invoiceDocumentId, env.DIAN_PROVIDER]
  );

  return inserted.rows[0]!;
}

export function buildOutboxSaleVoidedProcessor({
  pool,
  provider
}: BuildOutboxSaleVoidedProcessorInput) {
  return async (job: Job<OutboxSaleVoidedJobData>): Promise<void> => {
    const claimWindowMs = Math.max(env.OUTBOX_POLL_INTERVAL_MS * 4, 30000);
    const claimedEvent = await claimOutboxEvent(pool, job.data.outboxEventId, claimWindowMs);
    if (!claimedEvent) {
      await job.log(`Outbox event ${job.data.outboxEventId} no está pendiente o ya fue tomado`);
      return;
    }

    const rawPayload = typeof claimedEvent.payload_json === 'string'
      ? JSON.parse(claimedEvent.payload_json)
      : claimedEvent.payload_json;
      
    const payload = saleVoidedPayloadSchema.parse(rawPayload);

    const saleId = claimedEvent.aggregate_id;
    const tenantId = claimedEvent.tenant_id;
    const nextAttemptNumber = claimedEvent.attempts + 1;
    const idempotencyKey = buildIdempotencyKey(payload, tenantId, saleId);

    const invoiceDianDocument = await getInvoiceDianDocument(pool, tenantId, saleId);
    if (!invoiceDianDocument) {
      await job.log(`No se encontró dian_document INVOICE para la venta. Emitir nota de ajuste omitido.`);
      await markOutboxSent(pool, claimedEvent.id, nextAttemptNumber);
      return;
    }

    logWorkerInfo({
      event: 'dian_outbox_void_job_started',
      message: 'Processing SALE_VOIDED outbox event',
      job_id: job.id?.toString(),
      outbox_event_id: claimedEvent.id,
      sale_id: saleId,
      tenant_id: tenantId,
      attempt: nextAttemptNumber,
      dian_document_id: invoiceDianDocument.id,
      details: {
        current_dian_status: invoiceDianDocument.status,
        document_type: 'INVOICE'
      }
    });

    if (invoiceDianDocument.status === 'PENDING') {
      // La factura todavía no se envió. Dos escenarios:
      //  a) el evento sale.created ya se resolvió sin emitir (venta anulada antes de tiempo)
      //     -> no hay nada que anular ante la DIAN;
      //  b) el evento sigue en la bandeja -> hay que esperar a saber si sale o no.
      const pendingInvoiceEvent = await pool.query<{ id: string }>(
        `SELECT id FROM outbox_events
         WHERE tenant_id = $1 AND aggregate_id = $2
           AND type IN ('sale.created', 'SALE_CREATED', 'sale_created')
           AND status <> 'SENT'
         LIMIT 1`,
        [tenantId, saleId]
      );

      if (pendingInvoiceEvent.rows.length === 0) {
        await markOutboxSent(pool, claimedEvent.id, nextAttemptNumber);
        logWorkerInfo({
          event: 'dian_outbox_void_job_skipped',
          message: 'Anulación sin nota crédito: la factura nunca se emitió',
          job_id: job.id?.toString(),
          outbox_event_id: claimedEvent.id,
          sale_id: saleId,
          tenant_id: tenantId,
          attempt: nextAttemptNumber,
          dian_document_id: invoiceDianDocument.id,
          provider_result: 'SKIPPED',
          reason: 'INVOICE_NEVER_EMITTED'
        });
        return;
      }
    }

    if (invoiceDianDocument.status !== 'ACCEPTED') {
      const nextRetryAt = computeNextRetryAt(
        nextAttemptNumber,
        new Date(),
        env.OUTBOX_RETRY_BASE_MS,
        env.OUTBOX_RETRY_MAX_MS
      );
      await markOutboxFailed(pool, claimedEvent.id, nextAttemptNumber, nextRetryAt);
      await job.log(
        `Outbox ${claimedEvent.id} pospuesto. invoice_document=${invoiceDianDocument.id} aún no está ACCEPTED. current_status=${invoiceDianDocument.status}`
      );
      throw new Error('Dian invoice document not yet ACCEPTED');
    }

    const creditNoteDianDocument = await getOrCreateCreditNoteDianDocument(
      pool,
      tenantId,
      saleId,
      invoiceDianDocument.id
    );

    const emissionBlockReason = getDianEmissionBlockReason(
      creditNoteDianDocument.status,
      creditNoteDianDocument.cude
    );
    if (emissionBlockReason) {
      await markOutboxSent(pool, claimedEvent.id, claimedEvent.attempts);
      logWorkerInfo({
        event: 'dian_outbox_void_job_skipped',
        message: 'Skipped DIAN credit note emission due to idempotency guard',
        job_id: job.id?.toString(),
        outbox_event_id: claimedEvent.id,
        sale_id: saleId,
        tenant_id: tenantId,
        attempt: nextAttemptNumber,
        dian_document_id: creditNoteDianDocument.id,
        provider_result: 'SKIPPED',
        reason: emissionBlockReason,
        details: {
          invoice_dian_document_id: invoiceDianDocument.id,
          current_dian_status: creditNoteDianDocument.status,
          document_type: 'CREDIT_NOTE'
        }
      });
      await job.log(
        `Outbox ${claimedEvent.id} omitido por idempotencia. credit_note_document=${creditNoteDianDocument.id} status=${creditNoteDianDocument.status} reason=${emissionBlockReason}`
      );
      return;
    }

    let providerPayload;
    try {
      providerPayload = await loadProviderPayload(pool, tenantId, saleId, idempotencyKey, {
        document_type: 'CREDIT_NOTE'
      });
    } catch (loadError) {
      const errorMsg = loadError instanceof Error ? loadError.message : 'Unknown load error';
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
          message: 'Outbox void event permanently failed: referenced entity no longer exists',
          job_id: job.id?.toString(),
          outbox_event_id: claimedEvent.id,
          sale_id: saleId,
          tenant_id: tenantId,
          attempt: nextAttemptNumber,
          error: loadError
        });
        await job.log(`Outbox ${claimedEvent.id} permanentemente fallido (void): ${errorMsg}`);
        return;
      }
      throw loadError;
    }

    try {
      const providerResult = await provider.emitSale(providerPayload);
      const transitionPlan = planDianStatusTransition(
        creditNoteDianDocument.status,
        providerResult.status
      );

      await updateDianDocumentMetadata(
        pool,
        creditNoteDianDocument.id,
        providerPayload,
        providerResult.raw,
        transitionPlan.finalStatus,
        providerResult.cude
      );
      await markOutboxSent(pool, claimedEvent.id, nextAttemptNumber);
      logWorkerInfo({
        event: 'dian_outbox_void_job_succeeded',
        message: 'DIAN emission completed for sale voiding (Credit Note)',
        job_id: job.id?.toString(),
        outbox_event_id: claimedEvent.id,
        sale_id: saleId,
        tenant_id: tenantId,
        attempt: nextAttemptNumber,
        dian_document_id: creditNoteDianDocument.id,
        dian_transition: formatDianStatusTransitions(transitionPlan.transitions),
        provider_result: providerResult.status,
        details: {
          invoice_dian_document_id: invoiceDianDocument.id,
          final_dian_status: transitionPlan.finalStatus,
          cude: providerResult.cude ?? null,
          document_type: 'CREDIT_NOTE'
        }
      });
      await job.log(
        `Outbox ${claimedEvent.id} procesado para anulación. credit_note_document=${creditNoteDianDocument.id} provider_status=${providerResult.status} final_status=${transitionPlan.finalStatus}`
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

      await updateDianDocumentMetadata(pool, creditNoteDianDocument.id, providerPayload, errorPayload);
      await markOutboxFailed(pool, claimedEvent.id, nextAttemptNumber, nextRetryAt);
      logWorkerError({
        event: 'dian_outbox_void_job_failed',
        message: 'DIAN emission failed and will be retried (Credit Note)',
        job_id: job.id?.toString(),
        outbox_event_id: claimedEvent.id,
        sale_id: saleId,
        tenant_id: tenantId,
        attempt: nextAttemptNumber,
        dian_document_id: creditNoteDianDocument.id,
        dian_transition: `${creditNoteDianDocument.status}->${creditNoteDianDocument.status}`,
        provider_result: 'ERROR',
        next_retry_at: nextRetryAt.toISOString(),
        details: {
          invoice_dian_document_id: invoiceDianDocument.id,
          current_dian_status: creditNoteDianDocument.status,
          provider: env.DIAN_PROVIDER,
          document_type: 'CREDIT_NOTE'
        },
        error
      });
      await job.log(
        `Outbox ${claimedEvent.id} falló emitiendo Nota Crédito. credit_note_document=${creditNoteDianDocument.id} current_status=${creditNoteDianDocument.status} next_retry_at=${nextRetryAt.toISOString()} error=${errorPayload.error}`
      );

      throw error;
    }
  };
}
