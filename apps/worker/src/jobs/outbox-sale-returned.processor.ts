import type { Job } from 'bullmq';
import type { Pool } from 'pg';
import { env } from '../config/env.js';
import type { DianProvider } from '@pos-dian/shared/types/dian-provider.js';
import {
  getDianEmissionBlockReason,
  planDianStatusTransition
} from '../domain/dian-document-status.js';
import { logWorkerInfo } from '../infra/logging/worker-log.js';
import {
  buildIdempotencyKey,
  loadProviderPayload
} from './shared/dian-payload-builder.js';
import {
  claimOutboxEvent,
  getOrCreateDianDocument,
  markOutboxSent,
  updateDianDocumentMetadata
} from './shared/outbox-store.js';

export function buildOutboxSaleReturnedProcessor({
  pool,
  provider
}: {
  pool: Pool;
  provider: DianProvider;
}) {
  return async (job: Job): Promise<void> => {
    const claimWindowMs = Math.max(env.OUTBOX_POLL_INTERVAL_MS * 4, 30000);
    const claimedEvent = await claimOutboxEvent(pool, job.data.outboxEventId, claimWindowMs);
    if (!claimedEvent) {
      await job.log(`Outbox event ${job.data.outboxEventId} no está pendiente o ya fue tomado`);
      return;
    }

    const payloadObj = typeof claimedEvent.payload_json === 'string'
      ? JSON.parse(claimedEvent.payload_json)
      : claimedEvent.payload_json;

    const saleId = payloadObj.sale_id;
    const returnId = payloadObj.return_id;
    const tenantId = claimedEvent.tenant_id;
    const nextAttemptNumber = claimedEvent.attempts + 1;
    const idempotencyKey = buildIdempotencyKey(payloadObj, tenantId, returnId);

    // Creates or gets a Credit Note document specifically for this return
    const dianDocument = await getOrCreateDianDocument(pool, tenantId, returnId, 'CREDIT_NOTE');

    logWorkerInfo({
      event: 'dian_outbox_job_started',
      message: 'Processing SALE_RETURNED outbox event',
      job_id: job.id?.toString(),
      outbox_event_id: claimedEvent.id,
      sale_id: saleId,
      return_id: returnId,
      tenant_id: tenantId,
      attempt: nextAttemptNumber,
      dian_document_id: dianDocument.id
    });

    const emissionBlockReason = getDianEmissionBlockReason(dianDocument.status, dianDocument.cude);
    if (emissionBlockReason) {
      await markOutboxSent(pool, claimedEvent.id, claimedEvent.attempts);
      await job.log(`Outbox ${claimedEvent.id} omitido por idempotencia. reason=${emissionBlockReason}`);
      return;
    }

    // Load base payload from original sale
    const basePayload = await loadProviderPayload(pool, tenantId, saleId, idempotencyKey, {
      document_type: 'CREDIT_NOTE'
    });

    // Override with return specific data
    basePayload.void_reason = payloadObj.reason || 'Devolución parcial de venta';
    basePayload.sale.total_cents = payloadObj.total_refund_cents;
    basePayload.sale.subtotal_cents = payloadObj.total_refund_cents; // Simplified
    basePayload.sale.tax_total_cents = 0; // Simplified
    basePayload.sale.tax_lines = [];

    // We filter the items to only include the returned ones and update their qty and line_total
    const returnedItemsList = (payloadObj.items as Array<{ product_id: string; qty: number | string; refund_cents: number }>) || [];
    const returnedItemMap = new Map(returnedItemsList.map((i) => [i.product_id, i]));

    basePayload.sale.items = basePayload.sale.items
      .filter((item) => returnedItemMap.has(item.product_id))
      .map((item) => {
        const returnedData = returnedItemMap.get(item.product_id)!;
        return {
          ...item,
          qty: Number(returnedData.qty),
          line_total_cents: returnedData.refund_cents,
          base_cents: returnedData.refund_cents,
          tax_cents: 0
        };
      });

    try {
      const providerResult = await provider.emitSale(basePayload);
      const transitionPlan = planDianStatusTransition(dianDocument.status, providerResult.status);

      await updateDianDocumentMetadata(
        pool,
        dianDocument.id,
        basePayload,
        providerResult.raw,
        transitionPlan.finalStatus,
        providerResult.cude
      );

      if (transitionPlan.finalStatus === 'SENT' || transitionPlan.finalStatus === 'ACCEPTED') {
        await markOutboxSent(pool, claimedEvent.id, claimedEvent.attempts);
        await job.log(`Credit note emitted. provider_status=${providerResult.status}`);
      } else {
        throw new Error(`DIAN rejected credit note: ${JSON.stringify(providerResult.raw)}`);
      }
    } catch (error) {
      logWorkerInfo({
        event: 'dian_outbox_job_failed',
        message: 'Error emitting credit note',
        error: error instanceof Error ? error.message : 'Unknown'
      });
      throw error;
    }
  };
}
