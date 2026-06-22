import { Kysely } from 'kysely';
import { Database } from '../../../shared/infra/db/schema.js';
import { Waiter, CreateWaiterPayload, UpdateWaiterPayload } from '@pos-dian/shared';
import { randomUUID } from 'crypto';

export class WaitersRepository {
  constructor(private db: Kysely<Database>) {}

  async listWaiters(tenantId: string, branchId: string): Promise<Waiter[]> {
    const records = await this.db
      .selectFrom('waiters')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('branch_id', '=', branchId)
      .where('is_active', '=', true)
      .execute();

    return records.map(this.mapToEntity);
  }

  async getWaiterById(tenantId: string, id: string): Promise<Waiter | null> {
    const record = await this.db
      .selectFrom('waiters')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!record) return null;
    return this.mapToEntity(record);
  }

  async createWaiter(tenantId: string, branchId: string, payload: CreateWaiterPayload): Promise<Waiter> {
    const id = randomUUID();
    const record = await this.db
      .insertInto('waiters')
      .values({
        id,
        tenant_id: tenantId,
        branch_id: branchId,
        name: payload.name,
        pin: payload.pin ?? null,
        user_id: payload.user_id ?? null,
        is_active: true
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapToEntity(record);
  }

  async updateWaiter(tenantId: string, id: string, payload: UpdateWaiterPayload): Promise<Waiter> {
    let query = this.db.updateTable('waiters').where('tenant_id', '=', tenantId).where('id', '=', id);
    
    if (payload.name !== undefined) query = query.set('name', payload.name);
    if (payload.pin !== undefined) query = query.set('pin', payload.pin);
    if (payload.is_active !== undefined) query = query.set('is_active', payload.is_active);
    if (payload.user_id !== undefined) query = query.set('user_id', payload.user_id);

    query = query.set('updated_at', new Date());

    const record = await query.returningAll().executeTakeFirstOrThrow();
    return this.mapToEntity(record);
  }

  private mapToEntity(row: any): Waiter {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      branch_id: row.branch_id,
      user_id: row.user_id,
      name: row.name,
      pin: row.pin,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
