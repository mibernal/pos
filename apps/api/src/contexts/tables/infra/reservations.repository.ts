import { Kysely } from 'kysely';
import { Database } from '../../../shared/infra/db/schema.js';
import { executeAsTenant } from '../../../shared/infra/db/rls.js';
import { randomUUID } from 'crypto';
import { CreateReservationPayload, UpdateReservationPayload, Reservation } from '@pos-dian/shared';

export class ReservationsRepository {
  constructor(private readonly db: Kysely<Database>) { }

  async getReservations(tenantId: string, branchId: string, dateFrom?: Date, dateTo?: Date): Promise<Reservation[]> {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      let query = trx.selectFrom('reservations')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId);

      if (dateFrom) {
        query = query.where('reservation_date', '>=', dateFrom);
      }
      
      if (dateTo) {
        query = query.where('reservation_date', '<=', dateTo);
      }

      const rows = await query.orderBy('reservation_date', 'asc').selectAll().execute();
      
      return rows.map(r => ({
        id: r.id,
        tenantId: r.tenant_id,
        branchId: r.branch_id,
        customerId: r.customer_id,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        tableId: r.table_id,
        reservationDate: r.reservation_date.toISOString(),
        guestsCount: r.guests_count,
        status: r.status,
        notes: r.notes,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      }));
    });
  }

  async createReservation(tenantId: string, branchId: string, payload: CreateReservationPayload): Promise<Reservation> {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      const id = randomUUID();
      const row = await trx.insertInto('reservations')
        .values({
          id,
          tenant_id: tenantId,
          branch_id: branchId,
          customer_id: payload.customerId ?? null,
          customer_name: payload.customerName,
          customer_phone: payload.customerPhone ?? null,
          table_id: payload.tableId ?? null,
          reservation_date: new Date(payload.reservationDate),
          guests_count: payload.guestsCount,
          notes: payload.notes ?? null,
          status: 'PENDING'
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        id: row.id,
        tenantId: row.tenant_id,
        branchId: row.branch_id,
        customerId: row.customer_id,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        tableId: row.table_id,
        reservationDate: row.reservation_date.toISOString(),
        guestsCount: row.guests_count,
        status: row.status,
        notes: row.notes,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    });
  }

  async updateReservation(tenantId: string, branchId: string, id: string, payload: UpdateReservationPayload): Promise<Reservation> {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      let query = trx.updateTable('reservations')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('id', '=', id)
        .set({ updated_at: new Date() });

      if (payload.customerName !== undefined) query = query.set({ customer_name: payload.customerName });
      if (payload.customerPhone !== undefined) query = query.set({ customer_phone: payload.customerPhone ?? null });
      if (payload.customerId !== undefined) query = query.set({ customer_id: payload.customerId ?? null });
      if (payload.tableId !== undefined) query = query.set({ table_id: payload.tableId ?? null });
      if (payload.reservationDate !== undefined) query = query.set({ reservation_date: new Date(payload.reservationDate) });
      if (payload.guestsCount !== undefined) query = query.set({ guests_count: payload.guestsCount });
      if (payload.status !== undefined) query = query.set({ status: payload.status });
      if (payload.notes !== undefined) query = query.set({ notes: payload.notes ?? null });

      const row = await query.returningAll().executeTakeFirstOrThrow();

      return {
        id: row.id,
        tenantId: row.tenant_id,
        branchId: row.branch_id,
        customerId: row.customer_id,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        tableId: row.table_id,
        reservationDate: row.reservation_date.toISOString(),
        guestsCount: row.guests_count,
        status: row.status,
        notes: row.notes,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    });
  }
}
