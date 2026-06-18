import { Kysely } from 'kysely';
import { Database } from '../../../shared/infra/db/schema.js';
import { Redis } from 'ioredis';
import { getSaasBillingMetrics, SaasMetrics } from './billing-metrics.js';
import { RedisCache } from '../../../shared/infra/cache/RedisCache.js';
import { CACHE_KEYS } from '../../../shared/infra/cache/DashboardCacheKeys.js';
import { env } from '../../../app/env.js';

export async function getCachedSaasBillingMetrics(db: Kysely<Database>, redis: Redis): Promise<SaasMetrics> {
  const cache = new RedisCache(redis);
  return cache.getOrSet(
    CACHE_KEYS.BILLING_METRICS,
    env.CACHE_BILLING_METRICS_TTL_S,
    () => getSaasBillingMetrics(db)
  );
}
