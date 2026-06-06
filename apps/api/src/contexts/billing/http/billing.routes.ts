import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { createCheckoutSession } from '../application/create-checkout-session.js';

const checkoutBodySchema = z.object({
  planId: z.string(),
  gateway: z.enum(['WOMPI', 'MERCADOPAGO']),
  redirectUrl: z.string().url()
});

export const billingRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/billing/plans',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['billing'],
        security: [{ bearerAuth: [] }]
      }
    },
    async () => {
      const plans = await app.db
        .selectFrom('billing_plans')
        .select(['id', 'name', 'price_cents', 'billing_cycle', 'features_json'])
        .where('active', '=', true)
        .orderBy('price_cents', 'asc')
        .execute();

      return { plans };
    }
  );

  typedApp.post(
    '/billing/checkout',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['billing'],
        security: [{ bearerAuth: [] }],
        body: checkoutBodySchema
      }
    },
    async (request, reply) => {
      if (!request.auth) throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      
      // Solo el TENANT_OWNER puede pagar la suscripción
      if (request.auth.role !== 'TENANT_OWNER' && !request.auth.isPlatformRole) {
        throw new AppError(403, 'AUTH_FORBIDDEN', 'Solo el propietario puede actualizar la suscripción');
      }

      const payload = checkoutBodySchema.parse(request.body);

      const result = await createCheckoutSession(app.db, {
        tenantId: request.auth.tenantId!,
        planId: payload.planId,
        gateway: payload.gateway,
        customerEmail: request.auth.email,
        redirectUrl: payload.redirectUrl
      });

      return reply.code(201).send({
        checkoutUrl: result.checkoutUrl,
        transactionId: result.transactionId
      });
    }
  );
};
