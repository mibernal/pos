import { Kysely } from 'kysely';
import { Database } from '../../../shared/infra/db/schema.js';
import { RoomWithTables, Table, Room, CreateRoomPayload, CreateTablePayload, UpdateTableStatusPayload } from '@pos-dian/shared';
import { randomUUID } from 'crypto';
import { executeAsTenant } from '../../../shared/infra/db/rls.js';

export class TablesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async createRoom(tenantId: string, branchId: string, payload: CreateRoomPayload): Promise<Room> {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      const id = randomUUID();
      const result = await trx.insertInto('rooms')
        .values({
          id,
          tenant_id: tenantId,
          branch_id: branchId,
          name: payload.name,
          is_active: true
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return this.mapRoom(result);
    });
  }

  async getRoomsWithTables(tenantId: string, branchId: string): Promise<RoomWithTables[]> {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      const rooms = await trx.selectFrom('rooms')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('is_active', '=', true)
        .selectAll()
        .orderBy('created_at', 'asc')
        .execute();

      if (rooms.length === 0) return [];

      const tables = await trx.selectFrom('tables')
        .leftJoin('users', 'users.id', 'tables.waiter_id')
        .where('tables.tenant_id', '=', tenantId)
        .where('tables.branch_id', '=', branchId)
        .where('tables.is_active', '=', true)
        .select([
          'tables.id',
          'tables.tenant_id',
          'tables.branch_id',
          'tables.room_id',
          'tables.name',
          'tables.capacity',
          'tables.status',
          'tables.current_order_id',
          'tables.waiter_id',
          'tables.status_updated_at',
          'tables.is_active',
          'tables.created_at',
          'tables.updated_at',
          'users.name as waiter_name'
        ])
        .orderBy('tables.name', 'asc')
        .execute();

      // Sum total_cents for active orders associated with tables
      const tableIdsWithOrders = tables.filter(t => t.current_order_id).map(t => t.id);
      let orderTotals: Record<string, number> = {};
      let orderCreatedAts: Record<string, string> = {};

      if (tableIdsWithOrders.length > 0) {
        const activeOrders = await trx.selectFrom('tables as t')
          .innerJoin('table_orders as o', 'o.id', 't.current_order_id')
          .where('t.id', 'in', tableIdsWithOrders)
          .where('t.tenant_id', '=', tenantId)
          .select(['t.id as tableId', 'o.total_cents', 'o.created_at as orderCreatedAt'])
          .execute();

        orderTotals = activeOrders.reduce((acc, row) => {
          acc[row.tableId] = Number(row.total_cents);
          return acc;
        }, {} as Record<string, number>);

        orderCreatedAts = activeOrders.reduce((acc, row) => {
          acc[row.tableId] = row.orderCreatedAt instanceof Date
            ? row.orderCreatedAt.toISOString()
            : String(row.orderCreatedAt);
          return acc;
        }, {} as Record<string, string>);
      }

      return rooms.map(r => ({
        ...this.mapRoom(r),
        tables: tables
          .filter(t => t.room_id === r.id)
          .map(t => ({
            ...this.mapTable(t),
            currentTotalCents: orderTotals[t.id] ?? null,
            orderCreatedAt: orderCreatedAts[t.id] ?? null
          }))
      }));
    });
  }

  async createTable(tenantId: string, branchId: string, roomId: string, payload: CreateTablePayload): Promise<Table> {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      const id = randomUUID();
      const result = await trx.insertInto('tables')
        .values({
          id,
          tenant_id: tenantId,
          branch_id: branchId,
          room_id: roomId,
          name: payload.name,
          capacity: payload.capacity,
          status: 'AVAILABLE',
          current_order_id: null,
          is_active: true
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return this.mapTable(result);
    });
  }

  async updateTableStatus(tenantId: string, branchId: string, tableId: string, payload: UpdateTableStatusPayload): Promise<Table> {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      const result = await trx.updateTable('tables')
        .set({
          status: payload.status,
          current_order_id: payload.currentOrderId !== undefined ? payload.currentOrderId : undefined,
          status_updated_at: new Date()
        })
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('id', '=', tableId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return this.mapTable(result);
    });
  }

  async assignWaiter(tenantId: string, branchId: string, tableId: string, waiterId: string | null): Promise<Table> {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      const result = await trx.updateTable('tables')
        .set({
          waiter_id: waiterId,
          updated_at: new Date()
        })
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('id', '=', tableId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return this.mapTable(result);
    });
  }

  private mapRoom(row: any): Room {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      branchId: row.branch_id,
      name: row.name,
      isActive: row.is_active,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }

  private mapTable(row: any): Table {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      branchId: row.branch_id,
      roomId: row.room_id,
      name: row.name,
      capacity: row.capacity,
      status: row.status as any,
      currentOrderId: row.current_order_id,
      waiterId: row.waiter_id,
      waiterName: row.waiter_name,
      statusUpdatedAt: row.status_updated_at.toISOString(),
      isActive: row.is_active,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }
}
