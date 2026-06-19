import { randomUUID } from 'node:crypto';
import { trace, context } from '@opentelemetry/api';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import {
  validatorCompiler,
  serializerCompiler,
  type ZodTypeProvider
} from 'fastify-type-provider-zod';
import { Redis } from 'ioredis';
import { authPlugin } from '../shared/plugins/auth.js';
import { errorHandlerPlugin } from '../shared/plugins/error-handler.js';
import { registerSwagger } from '../shared/plugins/swagger.js';
import { idempotencyPlugin } from '../shared/infra/http/idempotency.plugin.js';
import { authRoutes } from '../contexts/identity/http/auth.routes.js';
import { platformAdminRoutes } from '../contexts/platform-admin/http/index.js';
import { branchesRoutes } from '../contexts/identity/http/branches.routes.js';
import { healthRoutes } from '../shared/http/health.routes.js';
import { salesRoutes } from '../contexts/sales/http/sales.routes.js';
import { adminTenantsRoutes } from '../contexts/identity/http/admin-tenants.routes.js';
import { adminUsersRoutes } from '../contexts/identity/http/admin-users.routes.js';
import { productsRoutes } from '../contexts/inventory/http/products.routes.js';
import { bulkRoutes } from '../contexts/inventory/http/bulk.routes.js';
import { enterpriseBulkRoutes } from '../contexts/inventory/http/enterprise-bulk.routes.js';

import { promotionsRoutes } from '../contexts/inventory/http/promotions.routes.js';
import { cashSessionsRoutes } from '../contexts/sales/http/cash-sessions.routes.js';
import { customersRoutes } from '../contexts/sales/http/customers.routes.js';
import { inventoryRoutes } from '../contexts/inventory/http/inventory.routes.js';
import { scannerRoutes } from '../contexts/inventory/http/scanner.routes.js';
import { alertsRoutes } from '../contexts/alerts/http/alerts.routes.js';
import { reportsRoutes } from '../contexts/reporting/http/reports.routes.js';
import { dashboardRoutes } from '../contexts/reporting/http/dashboard.routes.js';
import { globalDashboardRoutes } from '../contexts/reporting/http/global-dashboard.routes.js';
import { journalRoutes } from '../contexts/sales/http/journal.routes.js';
import { auditRoutes } from '../contexts/admin/http/audit.routes.js';
import { terminalsRoutes } from '../contexts/sales/http/terminals.routes.js';
import { billingRoutes } from '../contexts/billing/http/billing.routes.js';
import { webhooksRoutes } from '../contexts/billing/http/webhooks.routes.js';
import { tablesRoutes } from '../contexts/tables/presentation/tables.routes.js';
import { deliveriesRoutes } from '../contexts/deliveries/http/deliveries.routes.js';
import { auditContextStorage } from '../shared/infra/audit/audit-context.js';
import { createDb } from '../shared/infra/db/connection.js';
import { executeAsTenant } from '../shared/infra/db/rls.js';
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
      eval: async (script: string, numKeys: number, key: string, _arg1: string) => {
        const val = store.get(key);
        const next = (val ? parseInt(val, 10) : 0) + 1;
        store.set(key, next.toString());
        return next;
      },
      pipeline: () => {
        const pipe = {
          incr: () => pipe,
          expire: () => pipe,
          del: () => pipe,
          get: () => pipe,
          set: () => pipe,
          exec: async () => []
        } as unknown;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return pipe as any; // We might need to use eslint-disable for this if it's strictly needed
      },
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

  // C7: Eliminado dianQueue, pero agregamos bulkImportQueue para procesamiento asíncrono pesado.
  const redisClient = buildRedisClient();
  const { Queue } = await import('bullmq');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bulkImportQueue = new Queue('bulk-import-queue', { connection: redisClient as any });

  const app = Fastify({
    logger: {
      redact: ['req.headers.authorization', 'req.headers.cookie', 'password', 'body.password', 'body.token'],
      transport: {
        targets: [
          ...(env.NODE_ENV === 'development' ? [{ target: 'pino-pretty' }] : []),
          ...(process.env.ENABLE_LOKI === 'true'
            ? [
                {
                  target: 'pino-loki',
                  options: {
                    batching: true,
                    interval: 5,
                    host: env.NODE_ENV === 'development' ? 'http://localhost:3100' : 'http://loki:3100'
                  }
                }
              ]
            : [])
        ]
      }
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

  // Hook to record metrics
  const { apiLatencyHistogram, apiErrorsCounter } = await import('../tracing.js');

  app.addHook('onRequest', (request, reply, done) => {
    // OpenTelemetry integration
    const activeContext = context.active();
    const span = trace.getSpan(activeContext);
    const traceId = span?.spanContext().traceId;

    const correlationId = traceId || (request.headers['x-correlation-id'] as string) || randomUUID();

    // Store start time for latency metric
    (request as unknown as { startTime: [number, number] }).startTime = process.hrtime();

    // Inject trace_id and correlationId into Fastify logger
    request.log = request.log.child({ correlationId, trace_id: traceId });

    const auditContext = {
      correlationId,
      traceId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']
    };

    auditContextStorage.run(auditContext, done);
  });

  app.addHook('onResponse', (request, reply, done) => {
    const startTime = (request as unknown as { startTime?: [number, number] }).startTime;
    if (startTime) {
      const diff = process.hrtime(startTime);
      const latencyMs = (diff[0] * 1e9 + diff[1]) / 1e6;
      const route = request.routeOptions.url || request.url;
      apiLatencyHistogram.record(latencyMs, { method: request.method, route, status_code: reply.statusCode });
      
      if (reply.statusCode >= 400) {
        apiErrorsCounter.add(1, { method: request.method, route, status_code: reply.statusCode });
      }
    }
    done();
  });

  // Verify auth before running route handlers
  app.decorate('db', createDb());

  // el outbox en DB es el mecanismo de comunicación con el worker.
  app.decorate('redis', redisClient);
  app.decorate('bulkImportQueue', bulkImportQueue);

  app.decorateRequest('executeAsTenant', function (callback: any) {
    if (!this.auth?.tenantId) {
      throw new Error('Tenant context required but no tenantId found in request.auth');
    }
    return executeAsTenant(this.server.db, this.auth.tenantId, callback);
  });

  await app.register(import('@fastify/multipart').then((m) => m.default), {
    limits: {
      fileSize: 50 * 1024 * 1024 // 50MB limit
    }
  });

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
  await app.register(idempotencyPlugin);
  await app.register(registerSwagger);
  await app.register(authPlugin);

  // Register Socket.io
  await app.register(import('fastify-socket.io').then(m => m.default || m), {
    cors: {
      origin: Array.from(allowedOrigins),
      credentials: true
    }
  });

  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(platformAdminRoutes, { prefix: '/api/v1' });
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(branchesRoutes, { prefix: '/api/v1' });
  await app.register(adminTenantsRoutes, { prefix: '/api/v1' });
  await app.register(adminUsersRoutes, { prefix: '/api/v1' });
  await app.register(productsRoutes, { prefix: '/api/v1' });
  await app.register(bulkRoutes, { prefix: '/api/v1/inventory' });
  await app.register(enterpriseBulkRoutes, { prefix: '/api/v1/inventory/enterprise-bulk' });
  await app.register(promotionsRoutes, { prefix: '/api/v1' });
  await app.register(cashSessionsRoutes, { prefix: '/api/v1' });
  await app.register(salesRoutes, { prefix: '/api/v1' });
  await app.register(customersRoutes, { prefix: '/api/v1' });
  await app.register(inventoryRoutes, { prefix: '/api/v1' });
  await app.register(scannerRoutes, { prefix: '/api/v1' });
  await app.register(alertsRoutes, { prefix: '/api/v1' });
  await app.register(reportsRoutes, { prefix: '/api/v1' });
  await app.register(dashboardRoutes, { prefix: '/api/v1' });
  await app.register(globalDashboardRoutes, { prefix: '/api/v1' });
  await app.register(auditRoutes, { prefix: '/api/v1' });
  await app.register(terminalsRoutes, { prefix: '/api/v1' });
  await app.register(journalRoutes, { prefix: '/api/v1' });
  await app.register(billingRoutes, { prefix: '/api/v1' });
  await app.register(webhooksRoutes, { prefix: '/api/v1' });
  await app.register(tablesRoutes, { prefix: '/api/v1' });
  await app.register(deliveriesRoutes, { prefix: '/api/v1' });

  // Add prometheus metrics
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore: This module is installed via package.json but might not be built yet
  const fastifyMetrics = await import('fastify-metrics');
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error Plugin typings mismatch
  await app.register(fastifyMetrics.default || fastifyMetrics, {
    endpoint: '/metrics',
    defaultMetrics: { enabled: true }
  });

  app.addHook('onClose', async (instance) => {
    await instance.bulkImportQueue.close();
    await instance.redis.quit();
    await instance.db.destroy();
  });

  // Handle WS connections after all plugins are loaded
  app.ready().then(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app as any).io.on('connection', (socket: any) => {
      const branchId = socket.handshake.query.branchId as string;
      if (branchId) {
        socket.join(`branch:${branchId}`);
        app.log.info(`Socket ${socket.id} joined branch:${branchId}`);
      }
      
      socket.on('disconnect', () => {
        app.log.info(`Socket ${socket.id} disconnected`);
      });
    });
  });

  return app;
}
