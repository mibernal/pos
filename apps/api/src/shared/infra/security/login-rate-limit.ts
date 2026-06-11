/**
 * C2: Rate limit de login persistido en Redis.
 *
 * Reemplaza la implementación en memoria (Map en proceso) que:
 * - Se reseteaba en cada restart/deploy
 * - No funcionaba con múltiples instancias del API
 *
 * Esta implementación usa un script Lua atómico para eliminar la carrera
 * entre INCR y EXPIRE que existía en la versión anterior con dos comandos separados:
 * - INCR + condicional EXPIRE en una sola operación atómica vía eval()
 * - Clave: `ratelimit:{ip}:{normalizedEmail}`
 * - Sobrevive a restarts y escala horizontalmente
 */
import type { Redis } from 'ioredis';
import { env } from '../../../app/env.js';

const RATE_LIMIT_KEY_PREFIX = 'ratelimit';

// SEC: Script Lua para INCR atómico condicional.
// Si no existe, lo crea con expiración. Luego verifica si excede el límite.
const ATOMIC_RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return current
`;

export function buildLoginRateLimitKey(ipAddress: string, normalizedEmail: string, tenantId?: string): string {
  return `${RATE_LIMIT_KEY_PREFIX}:${tenantId || 'global'}:${ipAddress}:${normalizedEmail}`;
}

export function buildIpRateLimitKey(action: string, ipAddress: string): string {
  return `${RATE_LIMIT_KEY_PREFIX}:${action}:${ipAddress}`;
}

/**
 * Incrementa atómicamente el contador y lanza error si se supera el límite configurado.
 * Elimina la condición de carrera entre chequeo e incremento.
 */
export async function assertAndRecordLoginAttempt(redis: Redis, key: string): Promise<void> {
  const windowSeconds = Math.ceil(env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS / 1000);
  const current = await redis.eval(ATOMIC_RATE_LIMIT_LUA, 1, key, String(windowSeconds));
  
  if (Number(current) > env.AUTH_LOGIN_RATE_LIMIT_MAX) {
    throw new Error('LOGIN_RATE_LIMIT_EXCEEDED');
  }
}

/**
 * Incrementa atómicamente el contador para una IP y acción general (ej. refresh token).
 */
export async function assertAndRecordIpRateLimit(redis: Redis, key: string, max: number = 30, windowMs: number = 60000): Promise<void> {
  const windowSeconds = Math.ceil(windowMs / 1000);
  const current = await redis.eval(ATOMIC_RATE_LIMIT_LUA, 1, key, String(windowSeconds));
  
  if (Number(current) > max) {
    throw new Error('RATE_LIMIT_EXCEEDED');
  }
}

/**
 * Elimina la clave de rate limit (login exitoso).
 */
export async function clearLoginRateLimit(redis: Redis, key: string): Promise<void> {
  await redis.del(key);
}

// ── Fallback en memoria (solo para entorno de tests) ─────────────────────────
// Se mantiene la interfaz antigua para compatibilidad con tests que no usan Redis real.

const memoryStore = new Map<string, { attempts: number; resetAtMs: number }>();

export function assertAndRecordLoginAttemptSync(key: string, now = Date.now()): void {
  const existing = memoryStore.get(key);
  if (!existing || existing.resetAtMs <= now) {
    memoryStore.set(key, {
      attempts: 1,
      resetAtMs: now + env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS
    });
    return;
  }
  
  existing.attempts += 1;

  if (existing.attempts > env.AUTH_LOGIN_RATE_LIMIT_MAX) {
    throw new Error('LOGIN_RATE_LIMIT_EXCEEDED');
  }
}

export function assertAndRecordIpRateLimitSync(key: string, max: number = 30, windowMs: number = 60000, now = Date.now()): void {
  const existing = memoryStore.get(key);
  if (!existing || existing.resetAtMs <= now) {
    memoryStore.set(key, {
      attempts: 1,
      resetAtMs: now + windowMs
    });
    return;
  }
  
  existing.attempts += 1;

  if (existing.attempts > max) {
    throw new Error('RATE_LIMIT_EXCEEDED');
  }
}

export function clearLoginRateLimitSync(key: string): void {
  memoryStore.delete(key);
}

/** Solo para tests */
export function resetLoginRateLimitStore(): void {
  memoryStore.clear();
}
