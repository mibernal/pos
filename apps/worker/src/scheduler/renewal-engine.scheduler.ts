import type { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { Redis } from 'ioredis';
import type { Database } from '@pos-dian/api/src/shared/infra/db/schema.js';
import { RenewalEngine } from '@pos-dian/api/src/contexts/billing/application/renewal-engine.js';
import { env } from '../config/env.js';
import { logWorkerInfo, logWorkerError } from '../infra/logging/worker-log.js';

/**
 * Cliente de Redis propio del motor de cobro.
 *
 * El worker habla con Redis a través de las conexiones de BullMQ, que son configuraciones y
 * no clientes. Aquí hace falta un cliente de verdad para **invalidar la caché de
 * entitlements** en cuanto una suscripción cambia de estado: sin eso, un comercio recién
 * suspendido sigue viendo el producto entero hasta que la caché caduque sola, y —peor— el
 * que acaba de pagar sigue degradado cinco minutos más y llama a soporte.
 *
 * Perezoso y único: se abre en la primera pasada y se reutiliza, en vez de abrir una
 * conexión nueva cada quince minutos.
 */
let redisClient: Redis | null = null;

function getRedis(): Redis | undefined {
  if (redisClient) return redisClient;

  try {
    redisClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    redisClient.on('error', (error) => {
      logWorkerError({
        event: 'renewal_engine_redis_error',
        message: 'El cliente de Redis del motor de cobro falló',
        error
      });
    });
    return redisClient;
  } catch (error) {
    logWorkerError({
      event: 'renewal_engine_redis_unavailable',
      message: 'No se pudo abrir Redis; el cobro sigue igual y la caché caducará sola',
      error
    });
    return undefined;
  }
}

export async function runSubscriptionRenewals(pool: Pool) {
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool
    })
  });

  try {
    const results = await RenewalEngine.runAll(db, { redis: getRedis() });

    if (
      results.trials > 0 ||
      results.renewals > 0 ||
      results.retries > 0 ||
      results.suspensions > 0 ||
      results.upcoming > 0
    ) {
      logWorkerInfo({
        event: 'subscription_renewal_engine_run',
        message: 'Subscription renewal engine executed',
        details: results
      });
    }
  } catch (error) {
    logWorkerError({
      event: 'subscription_renewal_engine_error',
      message: 'Failed to run subscription renewal engine',
      error
    });
    throw error;
  }
}

/** Cierra el cliente al apagar el worker, para no dejar la conexión colgando. */
export async function closeRenewalEngineRedis(): Promise<void> {
  if (!redisClient) return;
  await redisClient.quit().catch(() => undefined);
  redisClient = null;
}
