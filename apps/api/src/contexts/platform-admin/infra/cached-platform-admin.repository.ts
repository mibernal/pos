import { Kysely } from 'kysely';
import { Database } from '../../../shared/infra/db/schema.js';
import { Redis } from 'ioredis';
import { PlatformAdminRepository } from './platform-admin.repository.js';
import { RedisCache } from '../../../shared/infra/cache/RedisCache.js';
import { CACHE_KEYS } from '../../../shared/infra/cache/DashboardCacheKeys.js';
import { env } from '../../../app/env.js';

export class CachedPlatformAdminRepository extends PlatformAdminRepository {
  private readonly cache: RedisCache;

  constructor(db: Kysely<Database>, redis: Redis) {
    super(db);
    this.cache = new RedisCache(redis);
  }

  override async getDashboardMetrics() {
    return this.cache.getOrSet(
      CACHE_KEYS.DASHBOARD_METRICS,
      env.CACHE_DASHBOARD_METRICS_TTL_S,
      () => super.getDashboardMetrics()
    );
  }

  override async getGrowthMetrics() {
    return this.cache.getOrSet(
      CACHE_KEYS.GROWTH_METRICS,
      env.CACHE_GROWTH_METRICS_TTL_S,
      () => super.getGrowthMetrics()
    );
  }
}
