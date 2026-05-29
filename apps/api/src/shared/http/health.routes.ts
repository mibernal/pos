import { sql } from 'kysely';
import type { FastifyPluginAsync } from 'fastify';

/**
 * C10: Health check mejorado — verifica DB y Redis activamente.
 * Responde 200 si todo OK, 503 si alguna dependencia falla.
 * Usado por load balancers y monitoreo.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['system']
      }
    },
    async (_, reply) => {
      const checks: Record<string, 'ok' | 'error'> = {};
      let healthy = true;

      // Verificar PostgreSQL
      try {
        await sql`SELECT 1`.execute(app.db);
        checks.database = 'ok';
      } catch {
        checks.database = 'error';
        healthy = false;
      }

      // Verificar Redis (C2 rate-limit store)
      try {
        await app.redis.ping();
        checks.redis = 'ok';
      } catch {
        checks.redis = 'error';
        healthy = false;
      }

      const status = healthy ? 'ok' : 'degraded';

      return reply
        .code(healthy ? 200 : 503)
        .send({
          status,
          service: 'api',
          checks,
          timestamp: new Date().toISOString()
        });
    }
  );
};
