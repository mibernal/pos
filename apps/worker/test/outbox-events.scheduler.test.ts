import type { Queue } from 'bullmq';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { enqueueDueOutboxEvents } from '../src/scheduler/outbox-events.scheduler.js';
import type { OutboxSaleCreatedJobData } from '../src/jobs/types.js';

describe('outbox events scheduler', () => {
  it('enqueues due SALE_CREATED outbox events as processable jobs', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          { id: 'outbox-1', type: 'SALE_CREATED' },
          { id: 'outbox-2', type: 'SALE_CREATED' }
        ]
      }))
    } as unknown as Pool;

    const queue = {
      add: vi.fn(async () => undefined)
    } as unknown as Queue<OutboxSaleCreatedJobData>;

    const limit = 25;
    const enqueued = await enqueueDueOutboxEvents(pool, queue, limit);

    expect(pool.query).toHaveBeenCalledOnce();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE type IN ('SALE_CREATED', 'SALE_VOIDED')"),
      expect.stringContaining("WHERE type IN ('SALE_CREATED', 'SALE_VOIDED', 'sale_returned')"),
      [25]
    );
    expect(enqueued).toBe(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenNthCalledWith(
      1,
      'process-sale-created-outbox-event',
      { outboxEventId: 'outbox-1' },
      {
        jobId: 'outbox:outbox-1',
        removeOnComplete: true,
        removeOnFail: true
      }
    );
    expect(queue.add).toHaveBeenNthCalledWith(
      2,
      'process-sale-created-outbox-event',
      { outboxEventId: 'outbox-2' },
      {
        jobId: 'outbox:outbox-2',
        removeOnComplete: true,
        removeOnFail: true
      }
    );
  });

  it('enqueues due SALE_VOIDED outbox events as credit-note jobs', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ id: 'outbox-voided', type: 'SALE_VOIDED' }]
      }))
    } as unknown as Pool;

    const queue = {
      add: vi.fn(async () => undefined)
    } as unknown as Queue<OutboxSaleCreatedJobData>;

    const enqueued = await enqueueDueOutboxEvents(pool, queue, 10);

    expect(enqueued).toBe(1);
    expect(queue.add).toHaveBeenCalledWith(
      'process-sale-voided-outbox-event',
      { outboxEventId: 'outbox-voided' },
      {
        jobId: 'outbox:outbox-voided',
        removeOnComplete: true,
        removeOnFail: true
      }
    );
  });
});
