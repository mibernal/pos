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

/** Se superó el límite. Es la respuesta legítima del limitador, no un fallo. */
export const LOGIN_RATE_LIMIT_EXCEEDED = 'LOGIN_RATE_LIMIT_EXCEEDED';
export const RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED';

/** Lo mínimo de un logger de pino que aquí se necesita. */
export interface RateLimitLogger {
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

function esLimiteSuperado(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === LOGIN_RATE_LIMIT_EXCEEDED || error.message === RATE_LIMIT_EXCEEDED)
  );
}

/**
 * Redis caído no puede significar «nadie entra».
 *
 * El limitador es una defensa, no una regla de negocio: si el contador compartido no
 * responde, contar en memoria es una defensa peor —por proceso, y se pierde al reiniciar—
 * pero es infinitamente mejor que dejar al comercio sin caja. La alternativa que había
 * —propagar el fallo— se traducía en un 429 «demasiados intentos» que era mentira y del
 * que no se salía esperando, o en una petición colgada para siempre.
 *
 * Se degrada, se avisa por el log, y se sigue.
 */
function degradarAMemoria(error: unknown, key: string, logger: RateLimitLogger | undefined, aplicar: () => void): void {
  if (esLimiteSuperado(error)) throw error;

  logger?.warn(
    { key, err: error instanceof Error ? error.message : String(error) },
    'Redis no respondió al limitador de intentos; se cuenta en memoria mientras dure'
  );
  aplicar();
}

/**
 * Incrementa atómicamente el contador y lanza error si se supera el límite configurado.
 * Elimina la condición de carrera entre chequeo e incremento.
 */
export async function assertAndRecordLoginAttempt(redis: Redis, key: string, logger?: RateLimitLogger): Promise<void> {
  const windowSeconds = Math.ceil(env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS / 1000);
  try {
    const current = await redis.eval(ATOMIC_RATE_LIMIT_LUA, 1, key, String(windowSeconds));

    if (Number(current) > env.AUTH_LOGIN_RATE_LIMIT_MAX) {
      throw new Error(LOGIN_RATE_LIMIT_EXCEEDED);
    }
  } catch (error) {
    degradarAMemoria(error, key, logger, () => assertAndRecordLoginAttemptSync(key));
  }
}

/**
 * Incrementa atómicamente el contador para una IP y acción general (ej. refresh token).
 */
export async function assertAndRecordIpRateLimit(
  redis: Redis,
  key: string,
  max: number = 30,
  windowMs: number = 60000,
  logger?: RateLimitLogger
): Promise<void> {
  const windowSeconds = Math.ceil(windowMs / 1000);
  try {
    const current = await redis.eval(ATOMIC_RATE_LIMIT_LUA, 1, key, String(windowSeconds));

    if (Number(current) > max) {
      throw new Error(RATE_LIMIT_EXCEEDED);
    }
  } catch (error) {
    degradarAMemoria(error, key, logger, () => assertAndRecordIpRateLimitSync(key, max, windowMs));
  }
}

/**
 * Elimina la clave de rate limit (login exitoso).
 *
 * Es de mejor esfuerzo: se llama cuando las credenciales ya se validaron, así que un fallo
 * aquí no puede tumbar un login legítimo. Lo peor que pasa si no se borra es que el
 * contador siga vivo hasta que expire su ventana.
 */
export async function clearLoginRateLimit(redis: Redis, key: string, logger?: RateLimitLogger): Promise<void> {
  try {
    await redis.del(key);
  } catch (error) {
    logger?.warn(
      { key, err: error instanceof Error ? error.message : String(error) },
      'No se pudo limpiar el contador de intentos tras un login válido'
    );
  }
  clearLoginRateLimitSync(key);
}

// ── Contador en memoria ──────────────────────────────────────────────────────
// Nació como apaño para los tests, que no levantan Redis. Hoy es además la red de
// seguridad de producción: es a esto a lo que se degrada el limitador cuando Redis no
// contesta. Cuenta por proceso y se pierde al reiniciar —peor defensa que la compartida,
// pero defensa.

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
    throw new Error(LOGIN_RATE_LIMIT_EXCEEDED);
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
    throw new Error(RATE_LIMIT_EXCEEDED);
  }
}

export function clearLoginRateLimitSync(key: string): void {
  memoryStore.delete(key);
}

/** Solo para tests */
export function resetLoginRateLimitStore(): void {
  memoryStore.clear();
}
