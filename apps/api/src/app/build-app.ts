import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import {
  validatorCompiler,
  serializerCompiler,
  type ZodTypeProvider
} from 'fastify-type-provider-zod';
import { Redis } from 'ioredis';
import { authPlugin } from '../plugins/auth.js';
import { errorHandlerPlugin } from '../plugins/error-handler.js';
import { registerSwagger } from '../plugins/swagger.js';
import { authRoutes } from '../routes/auth.js';
import { branchesRoutes } from '../routes/branches.js';
import { healthRoutes } from '../routes/health.js';
import { salesRoutes } from '../routes/sales.js';
import { adminTenantsRoutes } from '../routes/admin-tenants.js';
import { adminUsersRoutes } from '../routes/admin-users.js';
import { productsRoutes } from '../routes/products.js';
import { cashSessionsRoutes } from '../routes/cash-sessions.js';
import { customersRoutes } from '../routes/customers.js';
import { inventoryRoutes } from '../routes/inventory.js';
import { reportsRoutes } from '../routes/reports.js';
import { dashboardRoutes } from '../routes/dashboard.js';
import { createDb } from '../infra/db/connection.js';
import { env } from './env.js';
import { resolveCorsAllowedOrigins } from './cors.js';

const requestIdHeaderSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._:-]+$/);

/**
 * C2: Crea el cliente Redis para rate-limit y otros usos futuros.
 * En tests, devuelve un stub noop para no requerir Redis real.
 */
function buildRedisClient(): Redis {
  if (env.NODE_ENV === 'test') {
    const store = new Map<string, string>();
    return {
      get: async (key: string) => store.get(key) ?? null,
      incr: async (key: string) => {
        const val = store.get(key);
        const next = (val ? parseInt(val, 10) : 0) + 1;
        store.set(key, next.toString());
        return next;
      },
      expire: async () => 1,
      del: async (key: string) => {
        const existed = store.has(key);
        store.delete(key);
        return existed ? 1 : 0;
      },
      pipeline: () => ({
        incr: () => ({ expire: () => ({ exec: async () => null }) }),
        exec: async () => null
      }),
      ping: async () => 'PONG',
      quit: async () => 'OK'
    } as unknown as Redis;
  }

  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    lazyConnect: true
  });
}

export async function buildApp() {
  const allowedOrigins = new Set(resolveCorsAllowedOrigins(env.NODE_ENV, env.CORS_ALLOWED_ORIGINS));

  // C7: La API NO usa BullMQ directamente — el worker consume el outbox.
  // Solo necesitamos Redis para rate-limit. dianQueue eliminado del API.
  const redisClient = buildRedisClient();

  const app = Fastify({
    logger: {
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty'
            }
          : undefined
    },
    requestIdHeader: false,
    requestIdLogLabel: 'request_id',
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      const candidate = typeof header === 'string' ? header : Array.isArray(header) ? header[0] : undefined;
      const parsed = requestIdHeaderSchema.safeParse(candidate);
      if (parsed.success) {
        return parsed.data;
      }

      return randomUUID();
    }
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // C7: Eliminado app.decorate('dianQueue', ...) — el API no publica en BullMQ,
  // el outbox en DB es el mecanismo de comunicación con el worker.
  app.decorate('redis', redisClient);
  app.decorate('db', createDb());

  await app.register(import('@fastify/cookie').then((m) => m.default), {
    secret: env.JWT_SECRET // Use same secret for signed cookies if needed later
  });

  await app.register(cors, {
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed by CORS: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Branch-Id'],
    exposedHeaders: ['X-Request-Id']
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(errorHandlerPlugin);
  await app.register(registerSwagger);
  await app.register(authPlugin);
  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(branchesRoutes, { prefix: '/api/v1' });
  await app.register(adminTenantsRoutes, { prefix: '/api/v1' });
  await app.register(adminUsersRoutes, { prefix: '/api/v1' });
  await app.register(productsRoutes, { prefix: '/api/v1' });
  await app.register(cashSessionsRoutes, { prefix: '/api/v1' });
  await app.register(salesRoutes, { prefix: '/api/v1' });
  await app.register(customersRoutes, { prefix: '/api/v1' });
  await app.register(inventoryRoutes, { prefix: '/api/v1' });
  await app.register(reportsRoutes, { prefix: '/api/v1' });
  await app.register(dashboardRoutes, { prefix: '/api/v1' });

  app.addHook('onClose', async (instance) => {
    // C7: sin dianQueue, solo cerramos DB y Redis
    await instance.redis.quit();
    await instance.db.destroy();
  });

  return app;
}
