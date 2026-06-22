import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { KdsRepository } from '../infra/kds.repository.js';
import { KdsService } from '../application/kds.service.js';
import { KitchenTicketWithItemsSchema, UpdateKitchenTicketStatusSchema } from '@pos-dian/shared';
import { z } from 'zod';

const emitKdsUpdate = (request: any, branchId: string) => {
  if (request.user?.enableKitchenDisplay) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (request.server as any).io?.to(`branch:${branchId}`).emit('KITCHEN_TICKETS_UPDATED');
  }
};

export const kdsRoutes: FastifyPluginAsyncZod = async (app) => {
  const db = app.db;
  const kdsRepo = new KdsRepository(db);
  const kdsService = new KdsService(kdsRepo);

  app.get(
    '/branches/:branchId/kds/tickets',
    {
      schema: {
        params: z.object({ branchId: z.string().uuid() }),
        response: { 200: z.array(KitchenTicketWithItemsSchema) }
      }
    },
    async (request, reply) => {
      const { branchId } = request.params;
      const tenantId = request.auth!.tenantId!;

      const tickets = await kdsService.getActiveTickets(tenantId, branchId);
      return reply.send(tickets);
    }
  );

  app.put(
    '/branches/:branchId/kds/tickets/:id/status',
    {
      schema: {
        params: z.object({ branchId: z.string().uuid(), id: z.string().uuid() }),
        body: UpdateKitchenTicketStatusSchema,
        response: { 200: z.object({ success: z.boolean() }) }
      }
    },
    async (request, reply) => {
      const { branchId, id } = request.params;
      const tenantId = request.auth!.tenantId!;
      const { status } = request.body;

      await kdsService.updateTicketStatus(tenantId, id, status);
      
      emitKdsUpdate(request, branchId);
      
      return reply.send({ success: true });
    }
  );
};
