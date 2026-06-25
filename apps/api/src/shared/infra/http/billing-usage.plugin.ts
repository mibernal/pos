import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'crypto';

const BATCH_SIZE = 50;

// En memoria: contador de peticiones por tenant
const tenantRequestCounts = new Map<string, number>();

export const billingUsagePlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.addHook('onResponse', async (request, reply) => {
    // Solo contamos peticiones autenticadas
    const tenantId = (request.user as any)?.tenantId; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!tenantId) {
      return;
    }

    const currentCount = (tenantRequestCounts.get(tenantId) || 0) + 1;
    
    if (currentCount >= BATCH_SIZE) {
      // Reiniciamos el contador en memoria
      tenantRequestCounts.set(tenantId, 0);

      // Enviamos el lote al outbox asíncronamente (fire and forget)
      fastify.db.insertInto('outbox_events')
        .values({
          id: randomUUID(),
          tenant_id: tenantId,
          type: 'api_metric_tick',
          aggregate_type: 'tenant',
          aggregate_id: tenantId,
          payload_json: { count: BATCH_SIZE },
          metadata_json: null,
          status: 'PENDING'
        })
        .execute()
        .catch((err: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          request.log.error({ err, tenantId }, 'Failed to save API usage tick to outbox');
        });
    } else {
      tenantRequestCounts.set(tenantId, currentCount);
    }
  });
});
