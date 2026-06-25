import * as http from 'node:http';
import { Job, Queue, QueueEvents, Worker } from 'bullmq';
import { OUTBOX_QUEUE_NAME } from '@pos-dian/shared';
import { env } from './config/env.js';
import { createDbPool } from './infra/db/pool.js';
import { buildDianProvider } from './providers/index.js';
import { buildOutboxSaleCreatedProcessor } from './jobs/outbox-sale-created.processor.js';
import { buildOutboxSaleVoidedProcessor } from './jobs/outbox-sale-voided.processor.js';
import { buildOutboxSaleReturnedProcessor } from './jobs/outbox-sale-returned.processor.js';
import { buildOutboxLowStockAlertProcessor } from './jobs/outbox-low-stock-alert.processor.js';
import { buildApiMetricTickProcessor } from './jobs/api-metric-tick.processor.js';
import { buildBulkImportProcessor, BulkImportJobData } from './jobs/bulk-import.processor.js';
import type { AnyOutboxJobData, OutboxSaleCreatedJobData, OutboxSaleVoidedJobData, OutboxLowStockAlertJobData } from './jobs/types.js';
import { enqueueDueOutboxEvents } from './scheduler/outbox-events.scheduler.js';
import { recheckStuckDianDocuments } from './scheduler/dian-sent-recheck.scheduler.js';
import { ensureAuditLogPartitions } from './scheduler/audit-partitions.scheduler.js';
import { checkAbnormalRefunds } from './scheduler/alerts-abnormal-refunds.scheduler.js';
import { checkStalledOutboxEvents } from './scheduler/alerts-stalled-outbox.scheduler.js';
import { rollupDailySales } from './scheduler/rollup-daily-sales.scheduler.js';
import { rollupInventoryValuation } from './scheduler/rollup-inventory-valuation.scheduler.js';
import { rollupBillingUsage } from './scheduler/rollup-billing-usage.scheduler.js';
import { runHousekeepingJobs } from './scheduler/cleanup-housekeeping.scheduler.js';
import { runSubscriptionRenewals } from './scheduler/renewal-engine.scheduler.js';
import { logWorkerError, logWorkerInfo } from './infra/logging/worker-log.js';

const provider = buildDianProvider();
const dbPool = createDbPool();

const queue = new Queue<AnyOutboxJobData>(OUTBOX_QUEUE_NAME, {
  connection: {
    url: env.REDIS_URL
  }
});

const outboxSaleCreatedProcessor = buildOutboxSaleCreatedProcessor({ pool: dbPool, provider });
const outboxSaleVoidedProcessor = buildOutboxSaleVoidedProcessor({ pool: dbPool, provider });
const outboxSaleReturnedProcessor = buildOutboxSaleReturnedProcessor({ pool: dbPool, provider });
const outboxLowStockAlertProcessor = buildOutboxLowStockAlertProcessor({ pool: dbPool });
const apiMetricTickProcessor = buildApiMetricTickProcessor({ pool: dbPool });

const worker = new Worker<AnyOutboxJobData>(
  OUTBOX_QUEUE_NAME,
  async (job) => {
    if (job.name === 'process-sale-created-outbox-event') {
      return outboxSaleCreatedProcessor(job as Job<OutboxSaleCreatedJobData>);
    } else if (job.name === 'process-sale-voided-outbox-event') {
      return outboxSaleVoidedProcessor(job as Job<OutboxSaleVoidedJobData>);
    } else if (job.name === 'process-sale-returned-outbox-event') {
      return outboxSaleReturnedProcessor(job as Job<AnyOutboxJobData>);
    } else if (job.name === 'process-low-stock-alert-outbox-event') {
      return outboxLowStockAlertProcessor(job as Job<OutboxLowStockAlertJobData>);
    } else if (job.name === 'process-api-metric-tick-outbox-event') {
      return apiMetricTickProcessor(job as Job<{ outboxEventId: string }>);
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

const queueEvents = new QueueEvents(OUTBOX_QUEUE_NAME, {
  connection: {
    url: env.REDIS_URL
  }
});

const bulkImportProcessor = buildBulkImportProcessor(dbPool);
const bulkImportWorker = new Worker<BulkImportJobData>(
  'bulk-import-queue',
  async (job) => {
    return bulkImportProcessor(job);
  },
  {
    connection: { url: env.REDIS_URL },
    concurrency: 2 // Max 2 parallel enterprise imports to avoid overloading DB
  }
);

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

// C5: Scheduler de particiones (una vez al día)
const partitionCheckIntervalMs = 24 * 60 * 60 * 1000;
const partitionTimer: NodeJS.Timeout = setInterval(() => {
  void ensureAuditLogPartitions(dbPool).catch(err => {
    logWorkerError({
      event: 'audit_partition_scheduler_failed',
      message: 'Failed to run audit partition scheduler',
      error: err
    });
  });
}, partitionCheckIntervalMs);

// C6: Schedulers de Alertas Operativas Asíncronas
const alertsIntervalMs = 10 * 60 * 1000; // Check every 10 mins
const alertsTimer: NodeJS.Timeout = setInterval(() => {
  void checkAbnormalRefunds(dbPool).then(count => {
    if (count > 0) {
      logWorkerInfo({
        event: 'alert_abnormal_refunds_emitted',
        message: 'Emitted ABNORMAL_REFUNDS alerts',
        details: { count }
      });
    }
  }).catch(err => {
    logWorkerError({
      event: 'alert_abnormal_refunds_scheduler_failed',
      message: 'Failed to run abnormal refunds alert scheduler',
      error: err
    });
  });

  void checkStalledOutboxEvents(dbPool).then(count => {
    if (count > 0) {
      logWorkerInfo({
        event: 'alert_stalled_outbox_emitted',
        message: 'Emitted SYSTEM_OUTBOX_STALLED alerts',
        details: { count }
      });
    }
  }).catch(err => {
    logWorkerError({
      event: 'alert_stalled_outbox_scheduler_failed',
      message: 'Failed to run stalled outbox alert scheduler',
      error: err
    });
  });
}, alertsIntervalMs);

// C7: Schedulers de Agregación (Rollups)
const salesRollupIntervalMs = 5 * 60 * 1000; // 5 minutos
const salesRollupTimer = setInterval(() => {
  void rollupDailySales(dbPool).catch(err => {
    logWorkerError({
      event: 'rollup_daily_sales_failed',
      message: 'Failed to run daily sales rollup scheduler',
      error: err
    });
  });
}, salesRollupIntervalMs);

const inventoryRollupIntervalMs = 60 * 60 * 1000; // 1 hora
const inventoryRollupTimer = setInterval(() => {
  void rollupInventoryValuation(dbPool).catch(err => {
    logWorkerError({
      event: 'rollup_inventory_valuation_failed',
      message: 'Failed to run inventory valuation rollup scheduler',
      error: err
    });
  });
}, inventoryRollupIntervalMs);

const billingRollupIntervalMs = 24 * 60 * 60 * 1000; // 24 horas
const billingRollupTimer = setInterval(() => {
  void rollupBillingUsage(dbPool).catch(err => {
    logWorkerError({
      event: 'rollup_billing_usage_failed',
      message: 'Failed to run billing usage rollup scheduler',
      error: err
    });
  });
}, billingRollupIntervalMs);

// C8: Schedulers de Limpieza (Housekeeping)
const housekeepingIntervalMs = 24 * 60 * 60 * 1000; // 24 horas
const housekeepingTimer = setInterval(() => {
  void runHousekeepingJobs(dbPool).catch(err => {
    logWorkerError({
      event: 'housekeeping_scheduler_failed',
      message: 'Failed to run housekeeping scheduler',
      error: err
    });
  });
}, housekeepingIntervalMs);

// C9: Scheduler de Renovación de Suscripciones
const renewalIntervalMs = 15 * 60 * 1000; // 15 minutos
const renewalTimer = setInterval(() => {
  void runSubscriptionRenewals(dbPool).catch(err => {
    logWorkerError({
      event: 'renewal_scheduler_failed',
      message: 'Failed to run subscription renewal scheduler',
      error: err
    });
  });
}, renewalIntervalMs);

void ensureAuditLogPartitions(dbPool).catch(err => {
  logWorkerError({
    event: 'audit_partition_startup_failed',
    message: 'Failed to run audit partition scheduler on startup',
    error: err
  });
});

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
  const ip = req.socket.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const isPrivate = ip.startsWith('10.') || ip.startsWith('172.16.') || ip.startsWith('192.168.') || ip.startsWith('::ffff:10.') || ip.startsWith('::ffff:172.16.') || ip.startsWith('::ffff:192.168.');
  
  if (!isLocal && !isPrivate && process.env.NODE_ENV === 'production') {
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const port = process.env.WORKER_PORT || process.env.PORT || 8080;
const host = process.env.HOST || '127.0.0.1';
healthServer.listen(Number(port), host, () => {
  logWorkerInfo({
    event: 'health_server_started',
    message: `Worker health server listening on ${host}:${port}`
  });
});

const shutdown = async () => {
  healthServer.close();
  clearInterval(schedulerTimer);
  clearInterval(dianRecheckTimer);  // C4: cancelar el recheck timer
  clearInterval(partitionTimer); // C5: cancelar el partition timer
  clearInterval(alertsTimer); // C6: cancelar el alerts timer
  clearInterval(salesRollupTimer); // C7: cancelar rollups
  clearInterval(inventoryRollupTimer);
  clearInterval(billingRollupTimer);
  clearInterval(housekeepingTimer); // C8: cancelar housekeeping
  clearInterval(renewalTimer); // C9: cancelar renovación
  await Promise.all([worker.close(), bulkImportWorker.close(), queue.close(), queueEvents.close(), dbPool.end()]);
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
