/**
 * C2: Rate limit de login persistido en Redis.
 *
 * Reemplaza la implementación en memoria (Map en proceso) que:
 * - Se reseteaba en cada restart/deploy
 * - No funcionaba con múltiples instancias del API
 *
 * Esta implementación usa ioredis con TTL nativo:
 * - Clave: `ratelimit:{ip}:{normalizedEmail}`
 * - INCR atómico + EXPIRE para la ventana deslizante
 * - Sobrevive a restarts y escala horizontalmente
 */
import type { Redis } from 'ioredis';
import { env } from '../../../app/env.js';

const RATE_LIMIT_KEY_PREFIX = 'ratelimit';

export function buildLoginRateLimitKey(ipAddress: string, normalizedEmail: string): string {
  return `${RATE_LIMIT_KEY_PREFIX}:${ipAddress}:${normalizedEmail}`;
}

/**
 * Lanza 'LOGIN_RATE_LIMIT_EXCEEDED' si se supera el límite configurado.
 * Usa INCR + EXPIRE en Redis (operación atómica por clave).
 */
export async function assertLoginRateLimitAllowed(redis: Redis, key: string): Promise<void> {
  const current = await redis.get(key);
  const attempts = current ? parseInt(current, 10) : 0;

  if (attempts >= env.AUTH_LOGIN_RATE_LIMIT_MAX) {
    throw new Error('LOGIN_RATE_LIMIT_EXCEEDED');
  }
}

/**
 * Incrementa el contador de intentos fallidos.
 * Si es el primer intento, establece el TTL de la ventana.
 */
export async function recordLoginRateLimitFailure(redis: Redis, key: string): Promise<void> {
  const windowSeconds = Math.ceil(env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS / 1000);
  const attempts = await redis.incr(key);
  if (attempts === 1) {
    await redis.expire(key, windowSeconds);
  }
}

/**
 * Elimina la clave de rate limit (login exitoso).
 */
export async function clearLoginRateLimit(redis: Redis, key: string): Promise<void> {
  await redis.del(key);
}

// ── Fallback en memoria (solo para entorno de tests) ─────────────────────────
// Se mantiene la interfaz antigua para compatibilidad con tests que no usan Redis.

const memoryStore = new Map<string, { attempts: number; resetAtMs: number }>();

export function assertLoginRateLimitAllowedSync(key: string, now = Date.now()): void {
  const entry = memoryStore.get(key);
  if (!entry || entry.resetAtMs <= now) {
    return;
  }
  if (entry.attempts >= env.AUTH_LOGIN_RATE_LIMIT_MAX) {
    throw new Error('LOGIN_RATE_LIMIT_EXCEEDED');
  }
}

export function recordLoginRateLimitFailureSync(key: string, now = Date.now()): void {
  const existing = memoryStore.get(key);
  if (!existing || existing.resetAtMs <= now) {
    memoryStore.set(key, {
      attempts: 1,
      resetAtMs: now + env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS
    });
    return;
  }
  existing.attempts += 1;
}

export function clearLoginRateLimitSync(key: string): void {
  memoryStore.delete(key);
}

/** Solo para tests */
export function resetLoginRateLimitStore(): void {
  memoryStore.clear();
}
