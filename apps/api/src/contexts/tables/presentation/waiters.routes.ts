import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { WaitersRepository } from '../infra/waiters.repository.js';
import { WaitersService } from '../application/waiters.service.js';
import { WaiterSchema, CreateWaiterSchema, UpdateWaiterSchema } from '@pos-dian/shared';
import { z } from 'zod';

export const waitersRoutes: FastifyPluginAsyncZod = async (app) => {
  const db = app.db;
  const waitersRepo = new WaitersRepository(db);
  const waitersService = new WaitersService(waitersRepo);

  app.get(
    '/branches/:branchId/waiters',
    {
      schema: {
        params: z.object({ branchId: z.string().uuid() }),
        response: { 200: z.array(WaiterSchema) }
      },
      preHandler: [app.requireModule(['waiters'])]
    },
    async (request, reply) => {
      const { branchId } = request.params;
      const tenantId = request.auth!.tenantId!;

      const waiters = await waitersService.listWaiters(tenantId, branchId);
      return reply.send(waiters);
    }
  );

  app.post(
    '/branches/:branchId/waiters',
    {
      schema: {
        params: z.object({ branchId: z.string().uuid() }),
        body: CreateWaiterSchema,
        response: { 201: WaiterSchema }
      },
      preHandler: [app.requireModule(['waiters'])]
    },
    async (request, reply) => {
      const { branchId } = request.params;
      const tenantId = request.auth!.tenantId!;

      const waiter = await waitersService.createWaiter(tenantId, branchId, request.body);
      return reply.status(201).send(waiter);
    }
  );

  app.put(
    '/branches/:branchId/waiters/:id',
    {
      schema: {
        params: z.object({ branchId: z.string().uuid(), id: z.string().uuid() }),
        body: UpdateWaiterSchema,
        response: { 200: WaiterSchema }
      },
      preHandler: [app.requireModule(['waiters'])]
    },
    async (request, reply) => {
      const { id } = request.params;
      const tenantId = request.auth!.tenantId!;

      const waiter = await waitersService.updateWaiter(tenantId, id, request.body);
      return reply.send(waiter);
    }
  );
};
