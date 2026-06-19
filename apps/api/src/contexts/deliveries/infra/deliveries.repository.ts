import { type Database } from '../../../shared/infra/db/schema.js';
import { type Kysely, sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { 
  type CreateDeliveryPayload, 
  type DeliveryStatus, 
  type DeliveryWithItems,
  type DeliveryWithDetails,
  type DeliveryPerson
} from '@pos-dian/shared';

export class DeliveriesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async createDelivery(
    tenantId: string,
    branchId: string,
    deliveryId: string,
    payload: CreateDeliveryPayload,
    totalCents: number
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('deliveries')
        .values({
          id: deliveryId,
          tenant_id: tenantId,
          branch_id: branchId,
          status: 'PENDING',
          customer_name: payload.customerName,
          customer_phone: payload.customerPhone,
          delivery_address: payload.deliveryAddress,
          delivery_neighborhood: payload.deliveryNeighborhood || null,
          delivery_notes: payload.deliveryNotes || null,
          total_cents: totalCents,
        })
        .execute();

      const itemsToInsert = payload.items.map((item) => ({
        id: randomUUID(),
        tenant_id: tenantId,
        branch_id: branchId,
        delivery_id: deliveryId,
        product_id: item.productId,
        variant_id: item.variantId || null,
        qty: item.qty.toString(),
        price_cents: item.priceCents,
        line_total_cents: item.priceCents * item.qty,
      }));

      if (itemsToInsert.length > 0) {
        await trx.insertInto('delivery_items').values(itemsToInsert).execute();
      }
    });
  }

  async getDeliveryById(tenantId: string, branchId: string, id: string): Promise<DeliveryWithItems | null> {
    const delivery = await this.db
      .selectFrom('deliveries')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('branch_id', '=', branchId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!delivery) return null;

    const items = await this.db
      .selectFrom('delivery_items')
      .selectAll()
      .where('delivery_id', '=', id)
      .execute();

    return {
      id: delivery.id,
      tenantId: delivery.tenant_id,
      branchId: delivery.branch_id,
      status: delivery.status as DeliveryStatus,
      saleId: delivery.sale_id,
      customerName: delivery.customer_name,
      customerPhone: delivery.customer_phone,
      deliveryAddress: delivery.delivery_address,
      deliveryNeighborhood: delivery.delivery_neighborhood,
      deliveryNotes: delivery.delivery_notes,
      deliveryPersonId: delivery.delivery_person_id,
      totalCents: delivery.total_cents,
      createdAt: delivery.created_at.toISOString(),
      updatedAt: delivery.updated_at.toISOString(),
      statusUpdatedAt: delivery.status_updated_at.toISOString(),
      items: items.map(i => ({
        id: i.id,
        deliveryId: i.delivery_id,
        productId: i.product_id,
        variantId: i.variant_id,
        qty: Number(i.qty),
        priceCents: i.price_cents,
        lineTotalCents: i.line_total_cents
      }))
    };
  }

  async getActiveDeliveries(tenantId: string, branchId: string): Promise<DeliveryWithDetails[]> {
    const deliveries = await this.db
      .selectFrom('deliveries')
      .leftJoin('delivery_persons', 'delivery_persons.id', 'deliveries.delivery_person_id')
      .select([
        'deliveries.id',
        'deliveries.tenant_id',
        'deliveries.branch_id',
        'deliveries.status',
        'deliveries.sale_id',
        'deliveries.customer_name',
        'deliveries.customer_phone',
        'deliveries.delivery_address',
        'deliveries.delivery_neighborhood',
        'deliveries.delivery_notes',
        'deliveries.delivery_person_id',
        'deliveries.total_cents',
        'deliveries.created_at',
        'deliveries.updated_at',
        'deliveries.status_updated_at',
        'delivery_persons.name as person_name',
        'delivery_persons.phone as person_phone',
        'delivery_persons.is_active as person_is_active',
      ])
      .where('deliveries.tenant_id', '=', tenantId)
      .where('deliveries.branch_id', '=', branchId)
      .where('deliveries.status', 'not in', ['DELIVERED', 'CANCELLED'])
      .orderBy('deliveries.created_at', 'desc')
      .execute();

    if (deliveries.length === 0) return [];

    const deliveryIds = deliveries.map(d => d.id);
    const items = await this.db
      .selectFrom('delivery_items')
      .selectAll()
      .where('delivery_id', 'in', deliveryIds)
      .execute();

    return deliveries.map(d => {
      let deliveryPerson = undefined;
      if (d.delivery_person_id && d.person_name) {
        deliveryPerson = {
          id: d.delivery_person_id,
          tenantId: d.tenant_id,
          branchId: d.branch_id,
          name: d.person_name,
          phone: d.person_phone as string,
          isActive: d.person_is_active as boolean,
          createdAt: d.created_at.toISOString(),
          updatedAt: d.updated_at.toISOString()
        };
      }

      return {
        id: d.id,
        tenantId: d.tenant_id,
        branchId: d.branch_id,
        status: d.status as DeliveryStatus,
        saleId: d.sale_id,
        customerName: d.customer_name,
        customerPhone: d.customer_phone,
        deliveryAddress: d.delivery_address,
        deliveryNeighborhood: d.delivery_neighborhood,
        deliveryNotes: d.delivery_notes,
        deliveryPersonId: d.delivery_person_id,
        totalCents: d.total_cents,
        createdAt: d.created_at.toISOString(),
        updatedAt: d.updated_at.toISOString(),
        statusUpdatedAt: d.status_updated_at.toISOString(),
        deliveryPerson,
        items: items.filter(i => i.delivery_id === d.id).map(i => ({
          id: i.id,
          deliveryId: i.delivery_id,
          productId: i.product_id,
          variantId: i.variant_id,
          qty: Number(i.qty),
          priceCents: i.price_cents,
          lineTotalCents: i.line_total_cents
        }))
      };
    });
  }

  async updateDeliveryStatus(tenantId: string, branchId: string, id: string, status: DeliveryStatus, saleId?: string): Promise<void> {
    let updateQuery = this.db
      .updateTable('deliveries')
      .set({ 
        status, 
        status_updated_at: sql`now()`
      });
      
    if (saleId !== undefined) {
      updateQuery = updateQuery.set({ sale_id: saleId });
    }

    await updateQuery
      .where('tenant_id', '=', tenantId)
      .where('branch_id', '=', branchId)
      .where('id', '=', id)
      .execute();
  }

  async assignDeliveryPerson(tenantId: string, branchId: string, id: string, personId: string): Promise<void> {
    await this.db
      .updateTable('deliveries')
      .set({ delivery_person_id: personId })
      .where('tenant_id', '=', tenantId)
      .where('branch_id', '=', branchId)
      .where('id', '=', id)
      .execute();
  }
}
