import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import {
  validatorCompiler,
  type ZodTypeProvider
} from 'fastify-type-provider-zod';
import type { Queue } from 'bullmq';
import type { DianEmissionRequest } from '@pos-dian/shared';
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
import { buildDianQueue } from '../infra/queue/dian-queue.js';
import { createDb } from '../infra/db/connection.js';
import { env } from './env.js';
import { resolveCorsAllowedOrigins } from './cors.js';

const requestIdHeaderSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._:-]+$/);

function buildQueueForRuntime(): Queue<DianEmissionRequest> {
  if (env.NODE_ENV === 'test') {
    return {
      add: async () => ({ id: 'test-job-id' }),
      close: async () => undefined
    } as unknown as Queue<DianEmissionRequest>;
  }

  return buildDianQueue(env.REDIS_URL);
}

export async function buildApp() {
  const allowedOrigins = new Set(resolveCorsAllowedOrigins(env.NODE_ENV, env.CORS_ALLOWED_ORIGINS));
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

  app.decorate('dianQueue', buildQueueForRuntime());
  app.decorate('db', createDb());

  await app.register(cors, {
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
    credentials: true,
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

  app.addHook('onClose', async (instance) => {
    await instance.dianQueue.close();
    await instance.db.destroy();
  });

  return app;
}
