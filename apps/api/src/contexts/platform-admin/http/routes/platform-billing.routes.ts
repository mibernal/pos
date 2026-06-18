import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getCachedSaasBillingMetrics } from '../../../billing/application/cached-billing-metrics.js';

export const platformBillingRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/platform/billing/metrics',
    {
      schema: {
        tags: ['platform', 'billing'],
        summary: 'Obtiene métricas de facturación SaaS',
        security: [{ bearerAuth: [] }]
      }
    },
    async (request, reply) => {
      const metrics = await getCachedSaasBillingMetrics(app.db, app.redis);
      return reply.send({ metrics });
    }
  );
};
