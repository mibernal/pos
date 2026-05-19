import * as http from 'node:http';
import { Job, Queue, QueueEvents, Worker } from 'bullmq';
import { DIAN_QUEUE_NAME } from '@pos-dian/shared';
import { env } from './config/env.js';
import { createDbPool } from './infra/db/pool.js';
import { buildDianProvider } from './providers/index.js';
import { buildOutboxSaleCreatedProcessor } from './jobs/outbox-sale-created.processor.js';
import { buildOutboxSaleVoidedProcessor } from './jobs/outbox-sale-voided.processor.js';
import { buildOutboxSaleReturnedProcessor } from './jobs/outbox-sale-returned.processor.js';
import type { AnyOutboxJobData, OutboxSaleCreatedJobData, OutboxSaleVoidedJobData } from './jobs/types.js';
import { enqueueDueOutboxEvents } from './scheduler/outbox-events.scheduler.js';
import { recheckStuckDianDocuments } from './scheduler/dian-sent-recheck.scheduler.js';
import { logWorkerError, logWorkerInfo } from './infra/logging/worker-log.js';

const provider = buildDianProvider();
const dbPool = createDbPool();

const queue = new Queue<AnyOutboxJobData>(DIAN_QUEUE_NAME, {
  connection: {
    url: env.REDIS_URL
  }
});

const outboxSaleCreatedProcessor = buildOutboxSaleCreatedProcessor({ pool: dbPool, provider });
const outboxSaleVoidedProcessor = buildOutboxSaleVoidedProcessor({ pool: dbPool, provider });
const outboxSaleReturnedProcessor = buildOutboxSaleReturnedProcessor({ pool: dbPool, provider });

const worker = new Worker<AnyOutboxJobData>(
  DIAN_QUEUE_NAME,
  async (job) => {
    if (job.name === 'process-sale-created-outbox-event') {
      return outboxSaleCreatedProcessor(job as Job<OutboxSaleCreatedJobData>);
    } else if (job.name === 'process-sale-voided-outbox-event') {
      return outboxSaleVoidedProcessor(job as Job<OutboxSaleVoidedJobData>);
    } else if (job.name === 'process-sale-returned-outbox-event') {
      return outboxSaleReturnedProcessor(job as Job);
    }
    throw new Error(`Unknown job name: ${job.name}`);
  },
  {
    connection: {
      url: env.REDIS_URL
    },
    concurrency: 10
  }
);

const queueEvents = new QueueEvents(DIAN_QUEUE_NAME, {
  connection: {
    url: env.REDIS_URL
  }
});

worker.on('ready', () => {
  logWorkerInfo({
    event: 'worker_ready',
    message: 'Worker listo y escuchando cola DIAN'
  });
});

worker.on('completed', (job) => {
  logWorkerInfo({
    event: 'worker_job_completed',
    message: 'Worker job completed',
    job_id: job.id?.toString(),
    outbox_event_id: job.data.outboxEventId
  });
});

worker.on('failed', (job, error) => {
  logWorkerError({
    event: 'worker_job_failed',
    message: 'Worker job failed',
    job_id: job?.id?.toString(),
    outbox_event_id: job?.data.outboxEventId,
    error
  });
});

queueEvents.on('waiting', ({ jobId }) => {
  logWorkerInfo({
    event: 'queue_job_waiting',
    message: 'Job waiting in DIAN queue',
    job_id: jobId
  });
});

const schedulerTimer: NodeJS.Timeout = setInterval(() => {
  void enqueueDueOutboxEvents(dbPool, queue, env.OUTBOX_BATCH_SIZE)
    .then((enqueued) => {
      if (enqueued > 0) {
        logWorkerInfo({
          event: 'scheduler_outbox_enqueued',
          message: 'Outbox events enqueued by scheduler',
          details: {
            enqueued
          }
        });
      }
    })
    .catch((error) => {
      logWorkerError({
        event: 'scheduler_outbox_enqueue_failed',
        message: 'Scheduler failed while enqueuing outbox events',
        error
      });
    });
}, env.OUTBOX_POLL_INTERVAL_MS);

// C4: Scheduler de recheck para documentos DIAN en estado SENT
// Se ejecuta cada 5 minutos (3 veces el intervalo del outbox)
const dianRecheckIntervalMs = env.OUTBOX_POLL_INTERVAL_MS * 3;
const dianRecheckTimer: NodeJS.Timeout = setInterval(() => {
  void recheckStuckDianDocuments(dbPool, queue, env.OUTBOX_BATCH_SIZE)
    .then((recheckCount) => {
      if (recheckCount > 0) {
        logWorkerInfo({
          event: 'dian_sent_recheck_scheduled',
          message: 'DIAN SENT recheck enqueued stuck documents',
          details: { recheckCount }
        });
      }
    })
    .catch((error) => {
      logWorkerError({
        event: 'dian_sent_recheck_scheduler_failed',
        message: 'DIAN SENT recheck scheduler failed',
        error
      });
    });
}, dianRecheckIntervalMs);

void enqueueDueOutboxEvents(dbPool, queue, env.OUTBOX_BATCH_SIZE)
  .then((enqueued) => {
    if (enqueued > 0) {
      logWorkerInfo({
        event: 'scheduler_startup_outbox_enqueued',
        message: 'Startup scheduler enqueued outbox events',
        details: {
          enqueued
        }
      });
    }
  })
  .catch((error) => {
    logWorkerError({
      event: 'scheduler_startup_failed',
      message: 'Scheduler failed on startup',
      error
    });
  });

const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const port = process.env.PORT || 8080;
healthServer.listen(port, () => {
  logWorkerInfo({
    event: 'health_server_started',
    message: `Worker health server listening on port ${port}`
  });
});

const shutdown = async () => {
  healthServer.close();
  clearInterval(schedulerTimer);
  clearInterval(dianRecheckTimer);  // C4: cancelar el recheck timer
  await Promise.all([worker.close(), queue.close(), queueEvents.close(), dbPool.end()]);
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
