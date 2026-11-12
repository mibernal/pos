import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { closeWaiterShiftSchema, openWaiterShiftSchema } from '@pos-dian/shared';
import { WaiterShiftsService } from '../application/waiter-shifts.service.js';

/**
 * Turnos de mesero.
 *
 * Abrir un turno lo hace quien está en la caja —con el PIN del mesero delante— así que pide
 * `sales:create` y no un permiso de administración: exigir que pase un encargado cada vez
 * que entra un mesero es la clase de fricción que hace que la función no se use.
 */
export const waiterShiftsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/waiter-shifts/open',
    {
      preHandler: [app.requireModule(['waiter_shifts']), app.requirePermissions(['sales:create'])],
      schema: { tags: ['tables'], security: [{ bearerAuth: [] }], body: openWaiterShiftSchema }
    },
    async (request, reply) => {
      const turno = await request.executeAsTenant((trx) =>
        WaiterShiftsService.open(trx, request.auth!.tenantId!, request.body, request.auth!.userId)
      );
      return reply.code(201).send(turno);
    }
  );

  typedApp.post(
    '/waiter-shifts/:id/close',
    {
      preHandler: [app.requireModule(['waiter_shifts']), app.requirePermissions(['sales:create'])],
      schema: {
        tags: ['tables'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: closeWaiterShiftSchema
      }
    },
    async (request) =>
      request.executeAsTenant((trx) =>
        WaiterShiftsService.close(
          trx,
          request.auth!.tenantId!,
          request.params.id,
          request.auth!.userId,
          request.body.notes
        )
      )
  );

  typedApp.get(
    '/waiter-shifts',
    {
      preHandler: [app.requireModule(['waiter_shifts']), app.requirePermissions(['sales:create'])],
      schema: {
        tags: ['tables'],
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          branch_id: z.string().uuid(),
          open_only: z.coerce.boolean().optional().default(true)
        })
      }
    },
    async (request) =>
      request.executeAsTenant((trx) =>
        WaiterShiftsService.list(trx, request.auth!.tenantId!, request.query.branch_id, request.query.open_only)
      )
  );

  /** El corte, sin cerrar: lo que el mesero lleva hasta ahora. */
  typedApp.get(
    '/waiter-shifts/:id/summary',
    {
      preHandler: [app.requireModule(['waiter_shifts']), app.requirePermissions(['sales:create'])],
      schema: {
        tags: ['tables'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() })
      }
    },
    async (request) =>
      request.executeAsTenant((trx) =>
        WaiterShiftsService.summary(trx, request.auth!.tenantId!, request.params.id)
      )
  );
};
