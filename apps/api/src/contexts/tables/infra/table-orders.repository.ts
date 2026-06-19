import { Kysely } from 'kysely';
import { Database } from '../../../shared/infra/db/schema.js';
import { randomUUID } from 'crypto';
import { TransferTablePayload } from '@pos-dian/shared';

export interface TableOrderItemPayload {
  productId: string;
  variantId?: string | null;
  qty: number;
  priceCents: number;
  lineTotalCents: number;
}

export interface SaveTableOrderPayload {
  items: TableOrderItemPayload[];
}

export class TableOrdersRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async getTableOrder(tenantId: string, branchId: string, tableId: string) {
    const order = await this.db.selectFrom('table_orders')
      .where('tenant_id', '=', tenantId)
      .where('branch_id', '=', branchId)
      .where('table_id', '=', tableId)
      .where('status', '=', 'OPEN')
      .selectAll()
      .executeTakeFirst();

    if (!order) return null;

    const items = await this.db.selectFrom('table_order_items')
      .where('tenant_id', '=', tenantId)
      .where('branch_id', '=', branchId)
      .where('table_order_id', '=', order.id)
      .selectAll()
      .execute();

    return { order, items };
  }

  async saveTableOrder(tenantId: string, branchId: string, tableId: string, payload: SaveTableOrderPayload) {
    return await this.db.transaction().execute(async (trx) => {
      // Find existing order
      let order = await trx.selectFrom('table_orders')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('table_id', '=', tableId)
        .where('status', '=', 'OPEN')
        .selectAll()
        .executeTakeFirst();

      const subtotalCents = payload.items.reduce((sum, item) => sum + item.lineTotalCents, 0);
      const totalCents = subtotalCents; // No tax/discount logic for now

      if (!order) {
        const id = randomUUID();
        order = await trx.insertInto('table_orders')
          .values({
            id,
            tenant_id: tenantId,
            branch_id: branchId,
            table_id: tableId,
            status: 'OPEN',
            subtotal_cents: subtotalCents,
            discount_cents: 0,
            total_cents: totalCents,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
          
        await trx.updateTable('tables')
          .set({ status: 'OCCUPIED', current_order_id: id })
          .where('id', '=', tableId)
          .where('tenant_id', '=', tenantId)
          .where('branch_id', '=', branchId)
          .execute();
      } else {
        order = await trx.updateTable('table_orders')
          .set({
            subtotal_cents: subtotalCents,
            total_cents: totalCents,
            updated_at: new Date()
          })
          .where('id', '=', order.id)
          .returningAll()
          .executeTakeFirstOrThrow();
          
        await trx.updateTable('tables')
          .set({ status: 'OCCUPIED' })
          .where('id', '=', tableId)
          .where('tenant_id', '=', tenantId)
          .where('branch_id', '=', branchId)
          .execute();
      }

      // Delete existing items
      await trx.deleteFrom('table_order_items')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('table_order_id', '=', order.id)
        .execute();

      // Insert new items
      if (payload.items.length > 0) {
        const itemsToInsert = payload.items.map(item => ({
          id: randomUUID(),
          tenant_id: tenantId,
          branch_id: branchId,
          table_order_id: order.id,
          product_id: item.productId,
          variant_id: item.variantId || null,
          qty: item.qty,
          price_cents: item.priceCents,
          line_total_cents: item.lineTotalCents
        }));

        await trx.insertInto('table_order_items')
          .values(itemsToInsert)
          .execute();
      }

      const items = await trx.selectFrom('table_order_items')
        .where('table_order_id', '=', order.id)
        .selectAll()
        .execute();

      return { order, items };
    });
  }

  async clearTableOrder(tenantId: string, branchId: string, tableId: string) {
    return await this.db.transaction().execute(async (trx) => {
      const order = await trx.selectFrom('table_orders')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('table_id', '=', tableId)
        .where('status', '=', 'OPEN')
        .selectAll()
        .executeTakeFirst();

      if (order) {
        await trx.updateTable('table_orders')
          .set({ status: 'COMPLETED', updated_at: new Date() })
          .where('id', '=', order.id)
          .execute();
      }

      await trx.updateTable('tables')
        .set({ status: 'AVAILABLE', current_order_id: null })
        .where('id', '=', tableId)
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .execute();
    });
  }

  async transferTableOrder(
    tenantId: string, 
    branchId: string, 
    sourceTableId: string, 
    payload: TransferTablePayload,
    userId: string
  ) {
    return await this.db.transaction().execute(async (trx) => {
      // 1. Get Source Table and Order
      const sourceOrder = await trx.selectFrom('table_orders')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('table_id', '=', sourceTableId)
        .where('status', '=', 'OPEN')
        .selectAll()
        .executeTakeFirst();
        
      if (!sourceOrder) throw new Error('Source table order not found');
      
      const sourceItems = await trx.selectFrom('table_order_items')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('table_order_id', '=', sourceOrder.id)
        .selectAll()
        .execute();

      // 2. Identify items to move
      let itemsToMove = payload.items;
      if (!itemsToMove || itemsToMove.length === 0) {
        itemsToMove = sourceItems.map(item => ({
          productId: item.product_id,
          variantId: item.variant_id,
          qty: item.qty
        }));
      }

      // 3. Get or Create Destination Table Order
      let destOrder = await trx.selectFrom('table_orders')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('table_id', '=', payload.destinationTableId)
        .where('status', '=', 'OPEN')
        .selectAll()
        .executeTakeFirst();

      if (!destOrder) {
        const destOrderId = randomUUID();
        destOrder = await trx.insertInto('table_orders')
          .values({
            id: destOrderId,
            tenant_id: tenantId,
            branch_id: branchId,
            table_id: payload.destinationTableId,
            status: 'OPEN',
            subtotal_cents: 0,
            discount_cents: 0,
            total_cents: 0,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        await trx.updateTable('tables')
          .set({ status: 'OCCUPIED', current_order_id: destOrderId })
          .where('id', '=', payload.destinationTableId)
          .where('tenant_id', '=', tenantId)
          .where('branch_id', '=', branchId)
          .execute();
      }

      // 4. Move items
      const destItems = await trx.selectFrom('table_order_items')
        .where('table_order_id', '=', destOrder.id)
        .selectAll()
        .execute();

      const newSourceItemsMap = new Map(sourceItems.map(i => [`${i.product_id}-${i.variant_id || 'base'}`, { ...i }]));
      const newDestItemsMap = new Map(destItems.map(i => [`${i.product_id}-${i.variant_id || 'base'}`, { ...i }]));

      for (const reqItem of itemsToMove) {
        const key = `${reqItem.productId}-${reqItem.variantId || 'base'}`;
        const sourceItem = newSourceItemsMap.get(key);
        if (!sourceItem) continue; // Safety check

        const moveQty = Math.min(reqItem.qty, sourceItem.qty);
        if (moveQty <= 0) continue;

        // Reduce from source
        sourceItem.qty -= moveQty;
        sourceItem.line_total_cents = sourceItem.qty * sourceItem.price_cents;

        // Add to dest
        const destItem = newDestItemsMap.get(key);
        if (destItem) {
          destItem.qty += moveQty;
          destItem.line_total_cents = destItem.qty * destItem.price_cents;
        } else {
          newDestItemsMap.set(key, {
            id: randomUUID(),
            tenant_id: tenantId,
            branch_id: branchId,
            table_order_id: destOrder.id,
            product_id: reqItem.productId,
            variant_id: reqItem.variantId || null,
            qty: moveQty,
            price_cents: sourceItem.price_cents,
            line_total_cents: moveQty * sourceItem.price_cents,
            created_at: new Date()
          });
        }
      }

      // 5. Apply changes to DB
      // Clear all items from both orders
      await trx.deleteFrom('table_order_items')
        .where('table_order_id', 'in', [sourceOrder.id, destOrder.id])
        .execute();

      // Filter out zero-qty items and insert
      const finalSourceItems = Array.from(newSourceItemsMap.values()).filter(i => i.qty > 0);
      const finalDestItems = Array.from(newDestItemsMap.values()).filter(i => i.qty > 0);

      const itemsToInsert = [...finalSourceItems, ...finalDestItems].map(item => ({
        id: item.id || randomUUID(),
        tenant_id: tenantId,
        branch_id: branchId,
        table_order_id: item.table_order_id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        qty: item.qty,
        price_cents: item.price_cents,
        line_total_cents: item.line_total_cents
      }));

      if (itemsToInsert.length > 0) {
        await trx.insertInto('table_order_items')
          .values(itemsToInsert)
          .execute();
      }

      // 6. Recalculate Totals
      const sourceSubtotal = finalSourceItems.reduce((acc, item) => acc + item.line_total_cents, 0);
      const destSubtotal = finalDestItems.reduce((acc, item) => acc + item.line_total_cents, 0);

      if (sourceSubtotal === 0) {
        // Close source order
        await trx.updateTable('table_orders')
          .set({ status: 'COMPLETED', subtotal_cents: 0, total_cents: 0, updated_at: new Date() })
          .where('id', '=', sourceOrder.id)
          .execute();
        await trx.updateTable('tables')
          .set({ status: 'AVAILABLE', current_order_id: null })
          .where('id', '=', sourceTableId)
          .execute();
      } else {
        await trx.updateTable('table_orders')
          .set({ subtotal_cents: sourceSubtotal, total_cents: sourceSubtotal, updated_at: new Date() })
          .where('id', '=', sourceOrder.id)
          .execute();
      }

      await trx.updateTable('table_orders')
        .set({ subtotal_cents: destSubtotal, total_cents: destSubtotal, updated_at: new Date() })
        .where('id', '=', destOrder.id)
        .execute();

      // 7. Audit Log
      await trx.insertInto('audit_logs')
        .values({
          id: randomUUID(),
          tenant_id: tenantId,
          branch_id: branchId,
          user_id: userId,
          entity_type: 'TABLE_TRANSFER',
          entity_id: sourceOrder.id,
          action: 'TRANSFER_ITEMS',
          legacy_payload: JSON.stringify({ sourceTableId, destinationTableId: payload.destinationTableId, itemsMoved: itemsToMove }),
          old_values: null,
          new_values: null,
          ip_address: null,
          user_agent: null,
          correlation_id: null
        })
        .execute();

      return true;
    });
  }
}
