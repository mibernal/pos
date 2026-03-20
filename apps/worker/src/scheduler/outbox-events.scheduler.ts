import type { Queue } from 'bullmq';
import type { Pool } from 'pg';
import type { OutboxSaleCreatedJobData } from '../jobs/types.js';

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
      WHERE type IN ('SALE_CREATED', 'SALE_VOIDED')
        AND status IN ('PENDING', 'FAILED')
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY created_at ASC
      LIMIT $1
    `,
    [limit]
  );

  for (const row of rows) {
    try {
      const jobName =
        row.type === 'SALE_CREATED'
          ? 'process-sale-created-outbox-event'
          : 'process-sale-voided-outbox-event';

      await queue.add(
        jobName,
        { outboxEventId: row.id },
        {
          jobId: `outbox:${row.id}`,
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
