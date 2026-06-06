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
      },
      preHandler: (req, reply, done) => {
        // Permitir loopback y redes privadas (allowlist básica)
        const ip = req.ip;
        const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
        const isPrivate = ip.startsWith('10.') || ip.startsWith('172.16.') || ip.startsWith('192.168.');
        if (!isLocal && !isPrivate && process.env.NODE_ENV === 'production') {
          reply.code(403).send({ error: 'Forbidden' });
          return;
        }
        done();
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
