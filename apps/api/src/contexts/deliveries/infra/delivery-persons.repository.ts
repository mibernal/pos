import { type Database } from '../../../shared/infra/db/schema.js';
import { type Kysely } from 'kysely';
import { 
  type DeliveryPerson,
  type CreateDeliveryPersonPayload,
  type UpdateDeliveryPersonPayload
} from '@pos-dian/shared';
import { executeAsTenant } from '../../../shared/infra/db/rls.js';

export class DeliveryPersonsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(tenantId: string, branchId: string, id: string, payload: CreateDeliveryPersonPayload): Promise<void> {
    await executeAsTenant(this.db, tenantId, async (trx) => {
      await trx
        .insertInto('delivery_persons')
        .values({
          id,
          tenant_id: tenantId,
          branch_id: branchId,
          name: payload.name,
          phone: payload.phone,
          is_active: true
        })
        .execute();
    });
  }

  async update(tenantId: string, branchId: string, id: string, payload: UpdateDeliveryPersonPayload): Promise<void> {
    const updateObj: any = {};
    if (payload.name !== undefined) updateObj.name = payload.name;
    if (payload.phone !== undefined) updateObj.phone = payload.phone;
    if (payload.isActive !== undefined) updateObj.is_active = payload.isActive;

    if (Object.keys(updateObj).length === 0) return;

    await executeAsTenant(this.db, tenantId, async (trx) => {
      await trx
        .updateTable('delivery_persons')
        .set(updateObj)
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('id', '=', id)
        .execute();
    });
  }

  async getAllActive(tenantId: string, branchId: string): Promise<DeliveryPerson[]> {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      const rows = await trx
        .selectFrom('delivery_persons')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('is_active', '=', true)
        .orderBy('name', 'asc')
        .execute();

      return rows.map(r => ({
        id: r.id,
        tenantId: r.tenant_id,
        branchId: r.branch_id,
        name: r.name,
        phone: r.phone,
        isActive: r.is_active,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString()
      }));
    });
  }
}
