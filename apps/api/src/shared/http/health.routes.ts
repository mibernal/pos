import { sql } from 'kysely';
import type { FastifyPluginAsync } from 'fastify';

/**
 * Lo que tarda como mucho cada comprobación antes de darse por fallida.
 *
 * Un `try/catch` no protege de una dependencia que no contesta: protege de una que
 * responde mal. Sin este límite, una base o un Redis mudos dejaban `/health` colgado para
 * siempre, y un health check que no responde es peor que no tenerlo — el balanceador se
 * queda esperando y nunca llega a marcar la instancia como enferma, que es justo lo único
 * que este endpoint existe para conseguir.
 */
const TIEMPO_MAXIMO_POR_COMPROBACION_MS = 2_000;

async function conLimite<T>(promesa: Promise<T>, ms = TIEMPO_MAXIMO_POR_COMPROBACION_MS): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promesa,
      new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new Error('HEALTH_CHECK_TIMEOUT')), ms);
      })
    ]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

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
        await conLimite(sql`SELECT 1`.execute(app.db));
        checks.database = 'ok';
      } catch {
        checks.database = 'error';
        healthy = false;
      }

      // Verificar Redis (C2 rate-limit store)
      try {
        await conLimite(app.redis.ping());
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
