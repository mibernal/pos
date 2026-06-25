import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { DeliveriesRepository } from '../infra/deliveries.repository.js';
import { DeliveryPersonsRepository } from '../infra/delivery-persons.repository.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { 
  CreateDeliverySchema, 
  UpdateDeliveryStatusSchema, 
  AssignDeliveryPersonSchema, 
  CreateDeliveryPersonSchema, 
  UpdateDeliveryPersonSchema,
  DeliveryWithDetailsSchema,
  DeliveryWithItemsSchema,
  DeliveryPersonSchema
} from '@pos-dian/shared';

export const deliveriesRoutes: FastifyPluginAsyncZod = async (app) => {
  const db = app.db;
  
  const deliveriesRepo = new DeliveriesRepository(db);
  const deliveryPersonsRepo = new DeliveryPersonsRepository(db);

  // --- Delivery Persons ---
  app.post(
    '/branches/:branchId/delivery-persons',
    {
      schema: {
        summary: 'Create a delivery person',
        tags: ['Deliveries'],
        security: [{ bearerAuth: [] }],
        params: z.object({ branchId: z.string().uuid() }),
        body: CreateDeliveryPersonSchema,
        response: { 201: z.object({ id: z.string() }) }
      },
      preHandler: [app.requireModule(['delivery'])]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId } = request.params;
      const id = randomUUID();
      await deliveryPersonsRepo.create(tenantId, branchId, id, request.body);
      return reply.status(201).send({ id });
    }
  );

  app.get(
    '/branches/:branchId/delivery-persons',
    {
      schema: {
        summary: 'Get active delivery persons',
        tags: ['Deliveries'],
        security: [{ bearerAuth: [] }],
        params: z.object({ branchId: z.string().uuid() }),
        response: { 200: z.array(DeliveryPersonSchema) }
      },
      preHandler: [app.requireModule(['delivery'])]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId } = request.params;
      const persons = await deliveryPersonsRepo.getAllActive(tenantId, branchId);
      return reply.send(persons);
    }
  );

  app.patch(
    '/branches/:branchId/delivery-persons/:id',
    {
      schema: {
        summary: 'Update delivery person',
        tags: ['Deliveries'],
        security: [{ bearerAuth: [] }],
        params: z.object({ 
          branchId: z.string().uuid(),
          id: z.string().uuid()
        }),
        body: UpdateDeliveryPersonSchema,
        response: { 204: z.null() }
      },
      preHandler: [app.requireModule(['delivery'])]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId, id } = request.params;
      await deliveryPersonsRepo.update(tenantId, branchId, id, request.body);
      return reply.status(204).send(null);
    }
  );

  // --- Deliveries ---
  app.post(
    '/branches/:branchId/deliveries',
    {
      schema: {
        summary: 'Create a delivery',
        tags: ['Deliveries'],
        security: [{ bearerAuth: [] }],
        params: z.object({ branchId: z.string().uuid() }),
        body: CreateDeliverySchema,
        response: { 
          201: DeliveryWithItemsSchema,
          500: z.null()
        }
      },
      preHandler: [app.requireModule(['delivery'])]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId } = request.params;
      const id = randomUUID();
      const totalCents = request.body.items.reduce((acc, item) => acc + (item.priceCents * item.qty), 0);
      
      await deliveriesRepo.createDelivery(tenantId, branchId, id, request.body, totalCents);
      
      const created = await deliveriesRepo.getDeliveryById(tenantId, branchId, id);
      if (!created) {
        return reply.status(500).send(null);
      }
      return reply.status(201).send(created);
    }
  );

  app.get(
    '/branches/:branchId/deliveries',
    {
      schema: {
        summary: 'Get active deliveries',
        tags: ['Deliveries'],
        security: [{ bearerAuth: [] }],
        params: z.object({ branchId: z.string().uuid() }),
        response: { 200: z.array(DeliveryWithDetailsSchema) }
      },
      preHandler: [app.requireModule(['delivery'])]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId } = request.params;
      const deliveries = await deliveriesRepo.getActiveDeliveries(tenantId, branchId);
      return reply.send(deliveries);
    }
  );

  app.patch(
    '/branches/:branchId/deliveries/:id/status',
    {
      schema: {
        summary: 'Update delivery status',
        tags: ['Deliveries'],
        security: [{ bearerAuth: [] }],
        params: z.object({ 
          branchId: z.string().uuid(),
          id: z.string().uuid()
        }),
        body: UpdateDeliveryStatusSchema,
        response: { 
          200: DeliveryWithItemsSchema,
          404: z.null()
        }
      },
      preHandler: [app.requireModule(['delivery'])]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId, id } = request.params;
      await deliveriesRepo.updateDeliveryStatus(tenantId, branchId, id, request.body.status, request.body.saleId ?? undefined);
      const updated = await deliveriesRepo.getDeliveryById(tenantId, branchId, id);
      if (!updated) {
        return reply.status(404).send(null);
      }
      return reply.send(updated);
    }
  );

  app.patch(
    '/branches/:branchId/deliveries/:id/driver',
    {
      schema: {
        summary: 'Assign delivery person',
        tags: ['Deliveries'],
        security: [{ bearerAuth: [] }],
        params: z.object({ 
          branchId: z.string().uuid(),
          id: z.string().uuid()
        }),
        body: AssignDeliveryPersonSchema,
        response: { 
          200: DeliveryWithItemsSchema,
          404: z.null()
        }
      },
      preHandler: [app.requireModule(['delivery'])]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId, id } = request.params;
      await deliveriesRepo.assignDeliveryPerson(tenantId, branchId, id, request.body.deliveryPersonId);
      const updated = await deliveriesRepo.getDeliveryById(tenantId, branchId, id);
      if (!updated) {
        return reply.status(404).send(null);
      }
      return reply.send(updated);
    }
  );
};
