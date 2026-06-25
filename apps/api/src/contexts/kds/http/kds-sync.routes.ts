import type { FastifyPluginAsync } from 'fastify';
import { ensureUserCanAccessBranch } from '../../../shared/infra/security/permissions.js';
import { setupSseStream } from '../../../shared/infra/security/sse-limits.js';

export const kdsSyncRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/kds/stream',
    {
      preHandler: [app.requireModule(['kitchen_display'])]
    },
    (request, reply) => {
      if (!request.auth) {
        return reply.code(401).send({ message: 'No autorizado' });
      }

      const { tenantId } = request.auth;
      const { branch_id } = request.query as Record<string, string | undefined>;

      if (!tenantId) {
        return reply.code(400).send({ message: 'tenant_id es requerido para KDS' });
      }

      if (!branch_id) {
        return reply.code(400).send({ message: 'branch_id es requerido' });
      }

      try {
        ensureUserCanAccessBranch(request.auth, branch_id);
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        return reply.code(err.statusCode || 403).send({ message: err.message || 'No tienes acceso a esta sucursal' });
      }

      const stream = setupSseStream(request, reply);
      if (!stream) return;

      // Register client in PubSubService
      app.pubsub.addKdsClient(tenantId, branch_id, reply.raw);

      // El cierre se maneja automáticamente en addKdsClient, pero debemos
      // mantener el handler para evitar timeouts en Fastify
      request.raw.on('close', () => {
        // Log para depuración si se desea
        // app.log.info(`KDS SSE Client disconnected: ${tenantId}:${branch_id}`);
      });
    }
  );
};
