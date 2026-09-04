import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { settleTipsSchema, tipSettingsSchema } from '@pos-dian/shared';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { TipsService } from '../application/tips.service.js';

/**
 * Propinas: política del comercio, reparto del turno y liquidación.
 */
export const tipsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/settings/tips',
    { preHandler: [app.authenticate], schema: { tags: ['sales'], security: [{ bearerAuth: [] }] } },
    async (request) => {
      const ajustes = await request.executeAsTenant(async (trx) =>
        TipsService.settings(trx, request.auth!.tenantId!)
      );

      return { policy: ajustes.policy, auto_settle_on_close: ajustes.autoSettle };
    }
  );

  typedApp.put(
    '/settings/tips',
    {
      preHandler: [app.requirePermissions(['settings:manage'])],
      schema: { tags: ['sales'], security: [{ bearerAuth: [] }], body: tipSettingsSchema }
    },
    async (request, reply) => {
      const body = tipSettingsSchema.parse(request.body);

      await request.executeAsTenant(async (trx) =>
        TipsService.saveSettings(trx, request.auth!.tenantId!, body)
      );

      return reply.send(body);
    }
  );

  /** Qué se juntó en el turno y de quién es, antes de pagar nada. */
  typedApp.get(
    '/cash-sessions/:id/tips',
    {
      preHandler: [app.requirePermissions(['reports:view'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() })
      }
    },
    async (request) =>
      request.executeAsTenant(async (trx) =>
        TipsService.summary(trx, request.auth!.tenantId!, request.params.id)
      )
  );

  typedApp.post(
    '/cash-sessions/:id/tips/settle',
    {
      preHandler: [app.requirePermissions(['cash:close'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: settleTipsSchema
      }
    },
    async (request, reply) => {
      const body = settleTipsSchema.parse(request.body);

      const resultado = await request.executeAsTenant(async (trx) => {
        const turno = await trx
          .selectFrom('cash_sessions')
          .select(['id', 'branch_id', 'closed_at'])
          .where('tenant_id', '=', request.auth!.tenantId!)
          .where('id', '=', request.params.id)
          .executeTakeFirst();

        if (!turno) throw new AppError(404, 'CASH_SESSION_NOT_FOUND', 'El turno de caja no existe');

        /**
         * Con el turno cerrado no se puede sacar efectivo del cajón: el arqueo ya se firmó
         * con ese dinero dentro, y un movimiento posterior cambiaría una cifra que alguien
         * ya defendió. La parte electrónica sí se puede liquidar después.
         */
        if (turno.closed_at && body.pay_cash_now) {
          throw new AppError(
            409,
            'CASH_SESSION_ALREADY_CLOSED',
            'El turno ya está cerrado: solo se puede liquidar la propina electrónica'
          );
        }

        return TipsService.settle(trx, {
          tenantId: request.auth!.tenantId!,
          branchId: turno.branch_id,
          cashSessionId: turno.id,
          userId: request.auth!.userId,
          payCashNow: body.pay_cash_now,
          notes: body.notes
        });
      });

      return reply.code(201).send({
        settlement_id: resultado.settlementId,
        cash_movement_id: resultado.cashMovementId,
        summary: resultado.summary
      });
    }
  );
};
