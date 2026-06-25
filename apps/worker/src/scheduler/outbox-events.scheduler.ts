import type { Queue } from 'bullmq';
import type { Pool } from 'pg';
import type { OutboxSaleCreatedJobData } from '../jobs/types.js';

// Canonical event type names (dot.case format, established in Phase 6C)
const SUPPORTED_EVENT_TYPES = [
  'sale.created',
  'sale.voided',
  'sale.returned',
  'low_stock.alert',
  // Legacy SCREAMING_SNAKE_CASE names kept for backward compat with old records
  'SALE_CREATED',
  'SALE_VOIDED',
  'sale_created',
  'sale_voided',
  'sale_returned',
  'api_metric_tick'
];

interface OutboxEventToScheduleRow {
  id: string;
  type: string;
}

function isDuplicateJobError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.toLowerCase().includes('jobid') && error.message.toLowerCase().includes('exists');
}

export async function enqueueDueOutboxEvents(
  pool: Pool,
  queue: Queue<OutboxSaleCreatedJobData>,
  limit: number
): Promise<number> {
  const { rows } = await pool.query<OutboxEventToScheduleRow>(
    `
      SELECT id, type
      FROM outbox_events
      WHERE type = ANY($1)
        AND status IN ('PENDING', 'FAILED')
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY created_at ASC
      LIMIT $2
    `,
    [SUPPORTED_EVENT_TYPES, limit]
  );

  for (const row of rows) {
    try {
      let jobName = 'process-sale-created-outbox-event';
      if (row.type === 'sale.voided' || row.type === 'SALE_VOIDED' || row.type === 'sale_voided') {
        jobName = 'process-sale-voided-outbox-event';
      } else if (row.type === 'sale.returned' || row.type === 'sale_returned') {
        jobName = 'process-sale-returned-outbox-event';
      } else if (row.type === 'low_stock.alert') {
        jobName = 'process-low-stock-alert-outbox-event';
      } else if (row.type === 'api_metric_tick') {
        jobName = 'process-api-metric-tick-outbox-event';
      }

      await queue.add(
        jobName,
        { outboxEventId: row.id },
        {
          jobId: `outbox-${row.id}`,
          removeOnComplete: true,
          removeOnFail: true
        }
      );
    } catch (error) {
      if (isDuplicateJobError(error)) {
        continue;
      }
      throw error;
    }
  }

  return rows.length;
}
