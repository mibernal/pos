import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ReservationsRepository } from '../infra/reservations.repository.js';
import { ReservationSchema, CreateReservationSchema, UpdateReservationSchema, UpdateReservationStatusSchema } from '@pos-dian/shared';

export const reservationsRoutes = async (app: FastifyInstance) => {
  const repo = new ReservationsRepository(app.db);

  app.get(
    '/branches/:branchId/reservations',
    {
      schema: {
        summary: 'List reservations for a branch',
        tags: ['Reservations'],
        security: [{ bearerAuth: [] }],
        params: z.object({ 
          branchId: z.string().uuid()
        }),
        querystring: z.object({
          dateFrom: z.string().datetime().optional(),
          dateTo: z.string().datetime().optional()
        }),
        response: { 200: z.array(ReservationSchema) }
      },
      preHandler: [app.requireModule(['reservations'])]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId } = request.params;
      const { dateFrom, dateTo } = request.query as { dateFrom?: string, dateTo?: string };
      
      const from = dateFrom ? new Date(dateFrom) : undefined;
      const to = dateTo ? new Date(dateTo) : undefined;

      const reservations = await repo.getReservations(tenantId, branchId, from, to);
      return reply.send(reservations);
    }
  );

  app.post(
    '/branches/:branchId/reservations',
    {
      schema: {
        summary: 'Create a new reservation',
        tags: ['Reservations'],
        security: [{ bearerAuth: [] }],
        params: z.object({ 
          branchId: z.string().uuid()
        }),
        body: CreateReservationSchema,
        response: { 201: ReservationSchema }
      },
      preHandler: [app.requireModule(['reservations'])]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId } = request.params;
      
      const reservation = await repo.createReservation(tenantId, branchId, request.body);
      return reply.status(201).send(reservation);
    }
  );

  app.put(
    '/branches/:branchId/reservations/:id',
    {
      schema: {
        summary: 'Update an existing reservation',
        tags: ['Reservations'],
        security: [{ bearerAuth: [] }],
        params: z.object({ 
          branchId: z.string().uuid(),
          id: z.string().uuid()
        }),
        body: UpdateReservationSchema,
        response: { 200: ReservationSchema }
      },
      preHandler: [app.requireModule(['reservations'])]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId, id } = request.params;
      
      const reservation = await repo.updateReservation(tenantId, branchId, id, request.body);
      return reply.send(reservation);
    }
  );

  app.patch(
    '/branches/:branchId/reservations/:id/status',
    {
      schema: {
        summary: 'Update the status of a reservation',
        tags: ['Reservations'],
        security: [{ bearerAuth: [] }],
        params: z.object({ 
          branchId: z.string().uuid(),
          id: z.string().uuid()
        }),
        body: UpdateReservationStatusSchema,
        response: { 200: ReservationSchema }
      },
      preHandler: [app.requireModule(['reservations'])]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId, id } = request.params;
      
      const reservation = await repo.updateReservation(tenantId, branchId, id, { status: request.body.status });
      return reply.send(reservation);
    }
  );
};
