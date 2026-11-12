import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { env } from '../../../app/env.js';
import { createCheckoutSession } from '../application/create-checkout-session.js';
import { SubscriptionService, LIVE_SUBSCRIPTION_STATUSES } from '../application/subscription.service.js';
import { periodDaysForCycle } from '../../platform-admin/application/billing-plans/resolve-plan.js';

const checkoutBodySchema = z.object({
  planId: z.string(),
  gateway: z.enum(['WOMPI', 'MERCADOPAGO', 'STRIPE', 'MOCK']),
  redirectUrl: z.string().url(),
  autoRenew: z.boolean().default(false)
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
    async (request) => {
      const plans = await request.executeAsTenant(async (trx) => {
        return await trx
          .selectFrom('billing_plans')
          .select(['id', 'name', 'price_cents', 'billing_cycle', 'features_json'])
          .where('active', '=', true)
          .orderBy('price_cents', 'asc')
          .execute();
      });

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
      
      // Solo el TENANT_OWNER, ADMIN o un Super Admin (incluso suplantando) puede pagar la suscripción
      if (request.auth.role !== 'TENANT_OWNER' && request.auth.role !== 'ADMIN' && !request.auth.isPlatformRole && !(request.auth as any).isImpersonating) { // eslint-disable-line @typescript-eslint/no-explicit-any
        throw new AppError(403, 'AUTH_FORBIDDEN', 'Solo el propietario o administrador puede actualizar la suscripción');
      }

      const payload = checkoutBodySchema.parse(request.body);

      const result = await request.executeAsTenant(async (trx) => {
        return await createCheckoutSession(trx as any, {
          tenantId: request.auth!.tenantId!,
          planId: payload.planId,
          gateway: payload.gateway,
          customerEmail: request.auth!.email,
          redirectUrl: payload.redirectUrl,
          autoRenew: payload.autoRenew
        });
      });

      return reply.code(201).send({
        checkoutUrl: result.checkoutUrl,
        transactionId: result.transactionId
      });
    }
  );
  
  if (env.NODE_ENV !== 'production') {
    typedApp.get(
    '/billing/mock-checkout',
    {
      schema: {
        tags: ['billing'],
        querystring: z.object({
          reference: z.string(),
          redirectUrl: z.string().url()
        })
      }
    },
    async (request, reply) => {
      const { reference, redirectUrl } = request.query;

      // Update the transaction to APPROVED
      await app.db.transaction().execute(async (trx) => {
        const tx = await trx
          .updateTable('payment_transactions')
          .set({ status: 'APPROVED', updated_at: new Date() })
          .where('gateway_reference', '=', reference)
          .returning(['tenant_id', 'metadata_json'])
          .executeTakeFirst();

        if (tx) {
          const metadata = tx.metadata_json as { planId?: string } | null;
          if (metadata?.planId) {
            const planId = metadata.planId;

            // El periodo sale del ciclo del plan, no de un 30 fijo: si el checkout simulado
            // concediera siempre un mes, el modo de prueba dejaría de parecerse al real.
            const plan = await trx
              .selectFrom('billing_plans')
              .select(['billing_cycle'])
              .where('id', '=', planId)
              .executeTakeFirst();
            const periodDays = periodDaysForCycle(plan?.billing_cycle ?? 'MONTHLY');

            const sub = await trx
              .selectFrom('tenant_subscriptions')
              .select(['plan_id', 'status'])
              .where('tenant_id', '=', tx.tenant_id)
              .where('status', 'in', [...LIVE_SUBSCRIPTION_STATUSES])
              .orderBy('created_at', 'desc')
              .executeTakeFirst();

            await trx.updateTable('tenants')
              .set({ status: 'ACTIVE' })
              .where('id', '=', tx.tenant_id)
              .execute();

            if (sub?.plan_id !== planId) {
              await SubscriptionService.upgradeSubscription(trx, tx.tenant_id, planId);
            }

            if (sub?.status === 'ACTIVE') {
              await SubscriptionService.renewSubscription(trx, tx.tenant_id, periodDays);
            } else {
              await SubscriptionService.activateSubscription(trx, tx.tenant_id, periodDays);
            }
          }
        }
        return tx;
      });

      return reply.redirect(redirectUrl);
    }
  );
  }
};
