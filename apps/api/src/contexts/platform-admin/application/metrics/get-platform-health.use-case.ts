import { Kysely, sql } from 'kysely';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { Database } from '../../../../shared/infra/db/schema.js';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';

export class GetPlatformHealthUseCase {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly redis: Redis,
    private readonly queue: Queue
  ) {}

  async execute() {
    const startTotal = performance.now();
    let isDbHealthy = false;
    let dbLatency = 0;
    let isRedisHealthy = false;
    let redisLatency = 0;
    let activeWorkers = 0;
    let pendingJobs = 0;
    let isQueueHealthy = false;

    // Ping DB
    try {
      const dbStart = performance.now();
      await sql`SELECT 1`.execute(this.db);
      dbLatency = Math.round(performance.now() - dbStart);
      isDbHealthy = true;
    } catch {
      isDbHealthy = false;
    }

    // Ping Redis
    try {
      const redisStart = performance.now();
      await this.redis.ping();
      redisLatency = Math.round(performance.now() - redisStart);
      isRedisHealthy = true;
    } catch {
      isRedisHealthy = false;
    }

    // Ping BullMQ
    try {
      const workers = await this.queue.getWorkers();
      const jobCounts = await this.queue.getJobCounts();
      activeWorkers = workers.length;
      pendingJobs = jobCounts.waiting || 0;
      isQueueHealthy = true;
    } catch {
      isQueueHealthy = false;
    }

    const isAllHealthy = isDbHealthy && isRedisHealthy && isQueueHealthy;
    const globalStatus = isAllHealthy ? 'UP' : 'DEGRADED';
    const totalLatency = Math.round(performance.now() - startTotal);

    const mem = process.memoryUsage();

    return {
      status: globalStatus,
      timestamp: new Date().toISOString(),
      latency: totalLatency,
      uptime: process.uptime(),
      api: {
        version: process.env.npm_package_version || 'unknown',
        memory: {
          rss: mem.rss,
          heapTotal: mem.heapTotal,
          heapUsed: mem.heapUsed
        }
      },
      environment: {
        hostname: os.hostname(),
        nodeVersion: process.version
      },
      services: [
        {
          name: 'PostgreSQL',
          status: isDbHealthy ? 'UP' : 'DOWN',
          latencyMs: dbLatency
        },
        {
          name: 'Redis',
          status: isRedisHealthy ? 'UP' : 'DOWN',
          latencyMs: redisLatency
        },
        {
          name: 'BullMQ',
          status: isQueueHealthy ? 'UP' : 'DOWN',
          activeWorkers,
          pendingJobs
        }
      ]
    };
  }
}
