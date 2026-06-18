import { createDb } from '../db/connection.js';
import { Redis } from 'ioredis';
import { PlatformAdminRepository } from '../../../contexts/platform-admin/infra/platform-admin.repository.js';
import { CachedPlatformAdminRepository } from '../../../contexts/platform-admin/infra/cached-platform-admin.repository.js';
import { performance } from 'node:perf_hooks';

async function run() {
  const db = createDb();
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  const rawRepo = new PlatformAdminRepository(db);
  const cachedRepo = new CachedPlatformAdminRepository(db, redis);

  // Clear cache for a fair test
  const keys = await redis.keys('platform:dashboard:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  const ITERATIONS = 10;
  console.log(`\nRunning Benchmark (${ITERATIONS} iterations)...\n`);

  // 1. Without Cache
  const rawTimes: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await rawRepo.getDashboardMetrics();
    rawTimes.push(performance.now() - start);
  }

  // 2. With Cache (First call will be MISS, subsequent will be HIT)
  const cachedTimes: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await cachedRepo.getDashboardMetrics();
    cachedTimes.push(performance.now() - start);
  }

  // Calculate percentiles
  rawTimes.sort((a, b) => a - b);
  cachedTimes.sort((a, b) => a - b);

  const getPercentile = (arr: number[], p: number) => arr[Math.floor(arr.length * p)] ?? 0;

  console.log('--- Result ---');
  console.table({
    'Sin Cache (SQL Directo)': {
      'p50 (ms)': getPercentile(rawTimes, 0.5).toFixed(2),
      'p95 (ms)': getPercentile(rawTimes, 0.95).toFixed(2),
      'Total (ms)': rawTimes.reduce((a, b) => a + b, 0).toFixed(2)
    },
    'Con Cache (Redis)': {
      'p50 (ms)': getPercentile(cachedTimes, 0.5).toFixed(2),
      'p95 (ms)': getPercentile(cachedTimes, 0.95).toFixed(2),
      'Total (ms)': cachedTimes.reduce((a, b) => a + b, 0).toFixed(2)
    }
  });

  await redis.quit();
  await db.destroy();
}

run().catch(console.error);
