import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TablesRepository } from '../infra/tables.repository.js';
import { CreateRoomUseCase } from '../application/create-room.use-case.js';
import { GetRoomsWithTablesUseCase } from '../application/get-rooms-with-tables.use-case.js';
import { CreateTableUseCase } from '../application/create-table.use-case.js';
import { UpdateTableStatusUseCase } from '../application/update-table-status.use-case.js';
import { CreateRoomSchema, CreateTableSchema, UpdateTableStatusSchema, RoomSchema, RoomWithTablesSchema, TableSchema, TableOrderWithItemsSchema, SaveTableOrderPayloadSchema } from '@pos-dian/shared';
import { z } from 'zod';
import { TableOrdersRepository } from '../infra/table-orders.repository.js';
import { GetTableOrderUseCase } from '../application/get-table-order.use-case.js';
import { SaveTableOrderUseCase } from '../application/save-table-order.use-case.js';
import { ClearTableOrderUseCase } from '../application/clear-table-order.use-case.js';
import { TransferTableUseCase } from '../application/transfer-table.use-case.js';
import { TransferTablePayloadSchema } from '@pos-dian/shared';

const emitTablesUpdate = (request: any, branchId: string) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (request.server as any).io?.to(`branch:${branchId}`).emit('TABLES_UPDATED');
};

export const tablesRoutes: FastifyPluginAsyncZod = async (app) => {
  const db = app.db;
  
  const tablesRepo = new TablesRepository(db);
  const createRoomUseCase = new CreateRoomUseCase(tablesRepo);
  const getRoomsWithTablesUseCase = new GetRoomsWithTablesUseCase(tablesRepo);
  const createTableUseCase = new CreateTableUseCase(tablesRepo);
  const updateTableStatusUseCase = new UpdateTableStatusUseCase(tablesRepo);

  const tableOrdersRepo = new TableOrdersRepository(db);
  const getTableOrderUseCase = new GetTableOrderUseCase(tableOrdersRepo);
  const saveTableOrderUseCase = new SaveTableOrderUseCase(tableOrdersRepo);
  const clearTableOrderUseCase = new ClearTableOrderUseCase(tableOrdersRepo);
  const transferTableUseCase = new TransferTableUseCase(tableOrdersRepo);

  app.post(
    '/branches/:branchId/rooms',
    {
      schema: {
        summary: 'Create a room',
        tags: ['Tables'],
        security: [{ bearerAuth: [] }],
        params: z.object({ branchId: z.string().uuid() }),
        body: CreateRoomSchema,
        response: { 201: RoomSchema }
      },
      preHandler: [app.authenticate]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId } = request.params;
      const room = await createRoomUseCase.execute(tenantId, branchId, request.body);
      emitTablesUpdate(request, branchId);
      return reply.status(201).send(room);
    }
  );

  app.get(
    '/branches/:branchId/rooms',
    {
      schema: {
        summary: 'Get rooms and their tables',
        tags: ['Tables'],
        security: [{ bearerAuth: [] }],
        params: z.object({ branchId: z.string().uuid() }),
        response: { 200: z.array(RoomWithTablesSchema) }
      },
      preHandler: [app.authenticate]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId } = request.params;
      const rooms = await getRoomsWithTablesUseCase.execute(tenantId, branchId);
      return reply.send(rooms);
    }
  );

  app.post(
    '/branches/:branchId/rooms/:roomId/tables',
    {
      schema: {
        summary: 'Create a table inside a room',
        tags: ['Tables'],
        security: [{ bearerAuth: [] }],
        params: z.object({ 
          branchId: z.string().uuid(),
          roomId: z.string().uuid()
        }),
        body: CreateTableSchema,
        response: { 201: TableSchema }
      },
      preHandler: [app.authenticate]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId, roomId } = request.params;
      const table = await createTableUseCase.execute(tenantId, branchId, roomId, request.body);
      emitTablesUpdate(request, branchId);
      return reply.status(201).send(table);
    }
  );

  app.patch(
    '/branches/:branchId/tables/:tableId/status',
    {
      schema: {
        summary: 'Update table status',
        tags: ['Tables'],
        security: [{ bearerAuth: [] }],
        params: z.object({ 
          branchId: z.string().uuid(),
          tableId: z.string().uuid()
        }),
        body: UpdateTableStatusSchema,
        response: { 200: TableSchema }
      },
      preHandler: [app.authenticate]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId, tableId } = request.params;
      const table = await updateTableStatusUseCase.execute(tenantId, branchId, tableId, request.body);
      emitTablesUpdate(request, branchId);
      return reply.send(table);
    }
  );

  app.get(
    '/branches/:branchId/tables/:tableId/order',
    {
      schema: {
        summary: 'Get active order for a table',
        tags: ['Tables'],
        security: [{ bearerAuth: [] }],
        params: z.object({ 
          branchId: z.string().uuid(),
          tableId: z.string().uuid()
        }),
        response: { 
          200: TableOrderWithItemsSchema.nullable()
        }
      },
      preHandler: [app.authenticate]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId, tableId } = request.params;
      const order = await getTableOrderUseCase.execute(tenantId, branchId, tableId);
      return reply.send(order);
    }
  );

  app.put(
    '/branches/:branchId/tables/:tableId/order',
    {
      schema: {
        summary: 'Save active order for a table',
        tags: ['Tables'],
        security: [{ bearerAuth: [] }],
        params: z.object({ 
          branchId: z.string().uuid(),
          tableId: z.string().uuid()
        }),
        body: SaveTableOrderPayloadSchema,
        response: { 200: TableOrderWithItemsSchema }
      },
      preHandler: [app.authenticate]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId, tableId } = request.params;
      const order = await saveTableOrderUseCase.execute(tenantId, branchId, tableId, request.body);
      emitTablesUpdate(request, branchId);
      return reply.send(order);
    }
  );

  app.delete(
    '/branches/:branchId/tables/:tableId/order',
    {
      schema: {
        summary: 'Clear active order for a table',
        tags: ['Tables'],
        security: [{ bearerAuth: [] }],
        params: z.object({ 
          branchId: z.string().uuid(),
          tableId: z.string().uuid()
        }),
        response: { 204: z.null() }
      },
      preHandler: [app.authenticate]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { branchId, tableId } = request.params;
      await clearTableOrderUseCase.execute(tenantId, branchId, tableId);
      emitTablesUpdate(request, branchId);
      return reply.status(204).send(null);
    }
  );

  app.post(
    '/branches/:branchId/tables/:tableId/transfer',
    {
      schema: {
        summary: 'Transfer or merge a table order to another table',
        tags: ['Tables'],
        security: [{ bearerAuth: [] }],
        params: z.object({ 
          branchId: z.string().uuid(),
          tableId: z.string().uuid()
        }),
        body: TransferTablePayloadSchema,
        response: { 200: z.object({ success: z.boolean() }) }
      },
      preHandler: [app.authenticate]
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const userId = request.auth!.userId!;
      const { branchId, tableId } = request.params;
      await transferTableUseCase.execute(tenantId, branchId, tableId, request.body, userId);
      emitTablesUpdate(request, branchId);
      return reply.send({ success: true });
    }
  );
};
