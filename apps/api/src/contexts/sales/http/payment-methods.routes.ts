import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { upsertPaymentMethodSchema, PAYMENT_KIND_BEHAVIOR, PAYMENT_KINDS } from '@pos-dian/shared';
import { PaymentMethodsRepository } from '../infra/payment-methods.repository.js';

/**
 * El catálogo de medios de pago del comercio.
 *
 * Es lo que convierte «añadir Nequi» en una fila en lugar de un despliegue. La pantalla de
 * cobro lee de aquí qué botones mostrar, y el reporte Z de dónde salen los nombres.
 */
export const paymentMethodsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/payment-methods',
    {
      preHandler: [app.authenticate],
      schema: { tags: ['sales'], security: [{ bearerAuth: [] }] }
    },
    async (request) => {
      const methods = await request.executeAsTenant(async (trx) =>
        PaymentMethodsRepository.list(trx, request.auth!.tenantId!)
      );

      return {
        payment_methods: methods,
        /**
         * El comportamiento de cada tipo viaja con la respuesta para que la pantalla de
         * cobro sepa a cuál pedirle el efectivo entregado y a cuál una referencia, sin
         * repetir esa tabla en el frontend —que es exactamente cómo se desincronizaron los
         * 21 flags de módulo antes de la fase 7—.
         */
        kinds: PAYMENT_KINDS.map((kind) => ({ kind, ...PAYMENT_KIND_BEHAVIOR[kind] }))
      };
    }
  );

  typedApp.put(
    '/payment-methods/:code',
    {
      preHandler: [app.requirePermissions(['settings:manage'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        params: z.object({ code: z.string() }),
        body: upsertPaymentMethodSchema.omit({ code: true })
      }
    },
    async (request, reply) => {
      const code = request.params.code.toUpperCase();

      const method = await request.executeAsTenant(async (trx) =>
        PaymentMethodsRepository.upsert(trx, request.auth!.tenantId!, {
          ...upsertPaymentMethodSchema.omit({ code: true }).parse(request.body),
          code
        })
      );

      return reply.send({ payment_method: method });
    }
  );

  typedApp.delete(
    '/payment-methods/:code',
    {
      preHandler: [app.requirePermissions(['settings:manage'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        params: z.object({ code: z.string() })
      }
    },
    async (request, reply) => {
      // Apagar, no borrar: hay ventas que lo referencian y un Z antiguo tiene que poder
      // seguir diciendo con qué se cobró.
      await request.executeAsTenant(async (trx) =>
        PaymentMethodsRepository.deactivate(trx, request.auth!.tenantId!, request.params.code.toUpperCase())
      );

      return reply.code(204).send();
    }
  );
};
