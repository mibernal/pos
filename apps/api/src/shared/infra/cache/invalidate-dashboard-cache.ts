import { Redis } from 'ioredis';
import { RedisCache } from './RedisCache.js';
import { CACHE_KEYS } from './DashboardCacheKeys.js';

export async function invalidateDashboardCache(redisClient: Redis) {
  const cache = new RedisCache(redisClient);
  await cache.invalidatePattern(CACHE_KEYS.DASHBOARD_METRICS);
  await cache.invalidatePattern(CACHE_KEYS.GROWTH_METRICS);
  await cache.invalidatePattern(CACHE_KEYS.BILLING_METRICS);
}
