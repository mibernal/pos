import type { Job } from 'bullmq';
import type { Pool } from 'pg';
import { computeNextRetryAt } from '../outbox/backoff.js';
import type { OutboxLowStockAlertJobData } from './types.js';
import { logWorkerError, logWorkerInfo } from '../infra/logging/worker-log.js';
import { markOutboxFailed, markOutboxSent } from './shared/outbox-store.js';
import { env } from '../config/env.js';

import { z } from 'zod';

const lowStockAlertPayloadSchema = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  current_qty: z.number(),
  min_stock_alert_qty: z.number(),
});


interface BuildLowStockAlertProcessorInput {
  pool: Pool;
}

export function buildOutboxLowStockAlertProcessor({ pool }: BuildLowStockAlertProcessorInput) {
  return async function processLowStockAlertOutboxEvent(
    job: Job<OutboxLowStockAlertJobData>
  ): Promise<void> {
    const { outboxEventId } = job.data;

    // Claim the event with a 5-minute window to prevent double processing
    const claimWindowMs = 5 * 60 * 1000;
    const { rows: eventRows } = await pool.query<{
      id: string;
      tenant_id: string;
      aggregate_id: string;
      status: string;
      attempts: number;
      payload_json: unknown;
    }>(
      `
        UPDATE outbox_events
        SET next_retry_at = NOW() + ($2 * INTERVAL '1 millisecond')
        WHERE id = $1
          AND status IN ('PENDING', 'FAILED')
          AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        RETURNING id, tenant_id, aggregate_id, status, attempts, payload_json
      `,
      [outboxEventId, claimWindowMs]
    );

    const event = eventRows[0];
    if (!event) {
      logWorkerInfo({
        event: 'low_stock_alert_skip',
        message: 'Low stock alert event already claimed or not found',
        outbox_event_id: outboxEventId
      });
      return;
    }

    const rawPayload = typeof event.payload_json === 'string'
      ? JSON.parse(event.payload_json)
      : event.payload_json;
      
    const payload = lowStockAlertPayloadSchema.parse(rawPayload);
    const attempts = event.attempts + 1;

    try {
      // Current implementation: log the alert. 
      // In the future this would send an email/push notification/webhook.
      logWorkerInfo({
        event: 'low_stock_alert_triggered',
        message: 'Low stock alert fired',
        details: {
          tenant_id: event.tenant_id,
          product_id: payload.product_id,
          product_name: payload.product_name,
          branch_id: payload.branch_id,
          current_qty: payload.current_qty,
          min_stock_alert_qty: payload.min_stock_alert_qty
        }
      });

      // TODO (Phase 7): Integrate with notification service (email, push, webhook)
      // For now we mark as SENT to stop retries — the alert was "delivered" via logs.
      await markOutboxSent(pool, outboxEventId, attempts);
    } catch (error) {
      logWorkerError({
        event: 'low_stock_alert_failed',
        message: 'Failed to process low stock alert',
        outbox_event_id: outboxEventId,
        error
      });

      const nextRetryAt = computeNextRetryAt(
        attempts,
        new Date(),
        env.OUTBOX_RETRY_BASE_MS,
        env.OUTBOX_RETRY_MAX_MS
      );
      await markOutboxFailed(pool, outboxEventId, attempts, nextRetryAt);
      throw error;
    }
  };
}
