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
import { executeAsTenantClient } from '../infra/db/rls.js';

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

    // 1. Ejecutar descargo de inventario asíncrono e idempotente
    try {
      await executeAsTenantClient(pool, tenantId, async (client) => {
        // Verificar idempotencia de inventario (si ya existe transacción de venta, se omite)
        const existingTx = await client.query(
          `SELECT id FROM inventory_transactions WHERE reference_id = $1 AND operation = 'SALE' LIMIT 1`,
          [saleId]
        );
        if (existingTx.rows.length > 0) return;

        const itemsRes = await client.query(
          `SELECT id, product_id, variant_id, qty FROM sale_items WHERE tenant_id = $1 AND sale_id = $2`,
          [tenantId, saleId]
        );
        const items = itemsRes.rows;

        // Agrupar items
        const qtyByKey = new Map<string, { productId: string, variantId: string | null, qty: number }>();
        for (const item of items) {
          const key = `${item.product_id}|${item.variant_id || ''}`;
          const existing = qtyByKey.get(key);
          qtyByKey.set(key, {
            productId: item.product_id,
            variantId: item.variant_id || null,
            qty: (existing?.qty || 0) + Number(item.qty)
          });
        }

        for (const [key, req] of qtyByKey.entries()) {
          // Actualizar balances
          const balanceRes = await client.query(
            `INSERT INTO inventory_balances (tenant_id, branch_id, product_id, variant_id, on_hand_qty, updated_at)
             VALUES ($1::uuid, $2::uuid, $3::uuid, NULLIF($4, '')::uuid, $5, NOW())
             ON CONFLICT (tenant_id, branch_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
             DO UPDATE SET on_hand_qty = inventory_balances.on_hand_qty - $6, updated_at = NOW()
             RETURNING on_hand_qty`,
            [tenantId, payload.branch_id, req.productId, req.variantId, -req.qty, req.qty]
          );

          const onHandQty = Number(balanceRes.rows[0].on_hand_qty);

          // Obtener el user_id de la venta
          const saleRes = await client.query(
            `SELECT created_by_user_id FROM sales WHERE id = $1::uuid`,
            [saleId]
          );
          const userId = saleRes.rows[0]?.created_by_user_id || null;

          // Obtener UUID usando crypto de postgres
          await client.query(
            `INSERT INTO inventory_transactions 
           (id, tenant_id, branch_id, product_id, variant_id, operation, reference_id, qty_change, balance_after, notes, created_by_user_id)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, NULLIF($4, '')::uuid, 'SALE', $5::uuid, $6, $7, $8, NULLIF($9, '')::uuid)`,
            [tenantId, payload.branch_id, req.productId, req.variantId, saleId, -req.qty, onHandQty, `Venta #${payload.sale_number}`, userId]
          );

          const lastLedgerRes = await client.query(
            `SELECT sequence_number, hash FROM inventory_ledger
             WHERE tenant_id = $1::uuid AND branch_id = $2::uuid AND product_id = $3::uuid AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(NULLIF($4, '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
             ORDER BY sequence_number DESC LIMIT 1`,
            [tenantId, payload.branch_id, req.productId, req.variantId]
          );

          const sequenceNumber = lastLedgerRes.rows.length > 0 ? Number(lastLedgerRes.rows[0].sequence_number) + 1 : 1;
          const previousHash = lastLedgerRes.rows.length > 0 ? lastLedgerRes.rows[0].hash : '0000000000000000000000000000000000000000000000000000000000000000';

          const hashPayload: Record<string, any> = {
            tenantId,
            branchId: payload.branch_id,
            productId: req.productId,
            variantId: req.variantId,
            operation: 'SALE_DISCHARGE',
            qtyChange: -req.qty,
            balanceAfter: onHandQty,
            referenceId: saleId,
            sequenceNumber,
            previousHash
          };

          const keys = Object.keys(hashPayload).sort();
          const orderedPayload: Record<string, string> = {};
          for (const k of keys) {
            const v = hashPayload[k];
            orderedPayload[k] = v === null || v === undefined ? '' : String(v);
          }
          const hashString = JSON.stringify(orderedPayload);
          const hash = (await import('crypto')).createHash('sha256').update(hashString).digest('hex');

          await client.query(
            `INSERT INTO inventory_ledger
             (id, tenant_id, branch_id, product_id, variant_id, operation_type, qty_change, balance_after, reference_id, sequence_number, previous_hash, hash, created_at)
             VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, NULLIF($4, '')::uuid, 'SALE_DISCHARGE', $5, $6, $7::uuid, $8, $9, $10, NOW())`,
            [tenantId, payload.branch_id, req.productId, req.variantId, -req.qty, onHandQty, saleId, sequenceNumber, previousHash, hash]
          );

          const productRes = await client.query(
            `SELECT min_stock_alert_qty FROM products WHERE tenant_id = $1::uuid AND id = $2::uuid`,
            [tenantId, req.productId]
          );
          const minAlert = productRes.rows[0]?.min_stock_alert_qty;

          if (minAlert !== null && minAlert !== undefined && onHandQty <= minAlert) {
            const eventPayload = {
              product_id: req.productId,
              variant_id: req.variantId,
              branch_id: payload.branch_id,
              current_qty: onHandQty,
              min_stock_alert_qty: minAlert,
              sale_id: saleId
            };
            await client.query(
              `INSERT INTO outbox_events 
               (id, tenant_id, aggregate_type, aggregate_id, event_type, payload_json, status, attempts, created_at, updated_at)
               VALUES (gen_random_uuid(), $1::uuid, 'INVENTORY', $2::uuid, 'StockLowEvent', $3, 'PENDING', 0, NOW(), NOW())`,
              [tenantId, req.productId, JSON.stringify(eventPayload)]
            );
          }
        }
      });
      logWorkerInfo({
        event: 'sale_inventory_discharged',
        message: 'Successfully discharged inventory for sale',
        job_id: job.id?.toString(),
        sale_id: saleId,
        tenant_id: tenantId
      });
    } catch (invError) {
      logWorkerError({
        event: 'sale_inventory_discharge_failed',
        message: 'Failed to discharge inventory for sale (will be retried)',
        job_id: job.id?.toString(),
        sale_id: saleId,
        tenant_id: tenantId,
        error: invError
      });
      throw invError; // Dejar que BullMQ reintente todo el job si falla el inventario
    }

    // 1b. Ejecutar efectos secundarios asíncronos (Kitchen, Audit)
    try {
      await executeAsTenantClient(pool, tenantId, async (client) => {
        if (payload.table_order_id) {
          await client.query(
            `UPDATE kitchen_tickets
             SET status = 'DELIVERED', updated_at = NOW()
             WHERE table_order_id = $1::uuid AND tenant_id = $2::uuid AND status != 'DELIVERED'`,
            [payload.table_order_id, tenantId]
          );
        }

        if (payload.audit_payload) {
          const existingAudit = await client.query(
            `SELECT id FROM audit_logs WHERE entity_id = $1::uuid AND action = 'SALE_CREATED' LIMIT 1`,
            [saleId]
          );
          if (existingAudit.rows.length === 0) {
            const saleRes = await client.query(
              `SELECT created_by_user_id FROM sales WHERE id = $1::uuid`,
              [saleId]
            );
            const userId = saleRes.rows[0]?.created_by_user_id || null;

            await client.query(
              `INSERT INTO audit_logs 
               (id, tenant_id, branch_id, user_id, entity_type, entity_id, action, legacy_payload)
               VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'SALE', $4::uuid, 'SALE_CREATED', $5)`,
              [tenantId, payload.branch_id, userId, saleId, JSON.stringify(payload.audit_payload)]
            );
          }
        }
      });
    } catch (sideEffectsError) {
      logWorkerError({
        event: 'sale_side_effects_failed',
        message: 'Failed to execute side effects (kitchen/audit)',
        job_id: job.id?.toString(),
        sale_id: saleId,
        tenant_id: tenantId,
        error: sideEffectsError
      });
      throw sideEffectsError;
    }

    // 2. Emisión DIAN

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
