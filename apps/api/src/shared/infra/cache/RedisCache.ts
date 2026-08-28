import type { Redis } from 'ioredis';

export class RedisCache {
  constructor(private readonly redis: Redis) {}

  /**
   * Obtiene un valor desde el cache o ejecuta el callback para calcularlo, guardándolo con el TTL especificado.
   */
  async getOrSet<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    if (ttlSeconds <= 0) {
      return fn();
    }

    const cached = await this.redis.get(key);
    if (cached) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        // Ignorar el error de parseo y recalcular
      }
    }

    const result = await fn();
    await this.redis.set(key, JSON.stringify(result), 'EX', ttlSeconds);
    
    return result;
  }

  /**
   * Invalida todas las llaves que hagan match con el patrón dado usando SCAN + DEL.
   */
  async invalidatePattern(pattern: string): Promise<number> {
    let cursor = '0';
    let count = 0;

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;

      if (keys.length > 0) {
        await this.redis.del(...keys);
        count += keys.length;
      }
    } while (cursor !== '0');

    return count;
  }
}
