import { type Job } from 'bullmq';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import type { Database } from '@pos-dian/api/src/shared/infra/db/schema.js';
import { logWorkerError } from '../infra/logging/worker-log.js';

export function buildApiMetricTickProcessor({ pool }: { pool: Pool }) {
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool })
  });

  return async function processApiMetricTick(job: Job<{ outboxEventId: string }>) {
    const { outboxEventId } = job.data;
    
    try {
      await db.updateTable('outbox_events')
        .set({ status: 'SENT' })
        .where('id', '=', outboxEventId)
        .execute();
        
    } catch (err) {
      logWorkerError({
        event: 'api_metric_tick_failed',
        message: `Fallo al procesar api_metric_tick ${outboxEventId}`,
        error: err
      });
      throw err;
    }
  };
}
