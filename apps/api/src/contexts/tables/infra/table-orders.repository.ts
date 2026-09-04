import { Kysely } from 'kysely';
import { Database } from '../../../shared/infra/db/schema.js';
import { randomUUID } from 'crypto';
import { TransferTablePayload } from '@pos-dian/shared';
import { executeAsTenant } from '../../../shared/infra/db/rls.js';

export interface TableOrderItemPayload {
  productId: string;
  variantId?: string | null;
  qty: number;
  priceCents: number;
  lineTotalCents: number;
  course?: number;
  notes?: string | null;
}

export interface SaveTableOrderPayload {
  items: TableOrderItemPayload[];
  tipCents?: number;
  guestsCount?: number | null;
  waiterId?: string | null;
  orderType?: string;
}

export class TableOrdersRepository {
  constructor(private readonly db: Kysely<Database>) { }

  async getTableOrder(tenantId: string, branchId: string, tableId: string) {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      const order = await trx.selectFrom('table_orders')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('table_id', '=', tableId)
        .where('status', '=', 'OPEN')
        .selectAll()
        .executeTakeFirst();

      if (!order) return null;

      const items = await trx.selectFrom('table_order_items')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('table_order_id', '=', order.id)
        .selectAll()
        .execute();

      return { order, items };
    });
  }

  async saveTableOrder(tenantId: string, branchId: string, tableId: string, payload: SaveTableOrderPayload) {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      // 1. Find existing order WITH ROW LOCK for concurrency
      let order = await trx.selectFrom('table_orders')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('table_id', '=', tableId)
        .where('status', '=', 'OPEN')
        .forUpdate()
        .selectAll()
        .executeTakeFirst();

      const subtotalCents = payload.items.reduce((sum, item) => sum + item.lineTotalCents, 0);
      const tipCents = payload.tipCents ?? 0;
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
            tip_cents: tipCents,
            total_cents: totalCents,
            guests_count: payload.guestsCount ?? null,
            waiter_id: payload.waiterId ?? null,
            order_type: payload.orderType ?? 'DINE_IN'
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
            tip_cents: tipCents,
            guests_count: payload.guestsCount !== undefined ? payload.guestsCount : undefined,
            waiter_id: payload.waiterId !== undefined ? payload.waiterId : undefined,
            order_type: payload.orderType !== undefined ? payload.orderType : undefined,
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

      // 2. Fetch existing items for Reconciliation
      const existingItems = await trx.selectFrom('table_order_items')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('table_order_id', '=', order.id)
        .where('item_status', '!=', 'CANCELLED')
        .selectAll()
        .execute();

      // 3. Diffing Engine
      const itemsToInsert = [];
      const itemsToUpdate = [];
      const matchedExistingIds = new Set<string>();

      for (const payloadItem of payload.items) {
        const matchIndex = existingItems.findIndex(ei => 
          !matchedExistingIds.has(ei.id) &&
          ei.product_id === payloadItem.productId &&
          (ei.variant_id || null) === (payloadItem.variantId || null) &&
          ei.course === (payloadItem.course ?? 1)
        );

        if (matchIndex !== -1) {
          // UPDATE: Preserve ID, Modifiers and KDS timestamps
          const matchedItem = existingItems[matchIndex]!;
          matchedExistingIds.add(matchedItem.id);
          itemsToUpdate.push({
            id: matchedItem.id,
            qty: payloadItem.qty,
            price_cents: payloadItem.priceCents,
            line_total_cents: payloadItem.lineTotalCents,
            notes: payloadItem.notes || null,
          });
        } else {
          // INSERT: Totally new item
          itemsToInsert.push({
            id: randomUUID(),
            tenant_id: tenantId,
            branch_id: branchId,
            table_order_id: order.id,
            product_id: payloadItem.productId,
            variant_id: payloadItem.variantId || null,
            qty: payloadItem.qty,
            price_cents: payloadItem.priceCents,
            line_total_cents: payloadItem.lineTotalCents,
            course: payloadItem.course ?? 1,
            notes: payloadItem.notes || null,
            item_status: 'PENDING'
          });
        }
      }

      const itemsToCancel = existingItems.filter(ei => !matchedExistingIds.has(ei.id));

      // 4. Execute Reconciliation
      if (itemsToInsert.length > 0) {
        await trx.insertInto('table_order_items')
          .values(itemsToInsert)
          .execute();
      }

      for (const updateItem of itemsToUpdate) {
        await trx.updateTable('table_order_items')
          .set({
            qty: updateItem.qty,
            price_cents: updateItem.price_cents,
            line_total_cents: updateItem.line_total_cents,
            notes: updateItem.notes
          })
          .where('id', '=', updateItem.id)
          .execute();
      }

      for (const cancelItem of itemsToCancel) {
        await trx.updateTable('table_order_items')
          .set({
            item_status: 'CANCELLED',
            qty: 0,
            line_total_cents: 0
          })
          .where('id', '=', cancelItem.id)
          .execute();
      }

      const finalItems = await trx.selectFrom('table_order_items')
        .where('table_order_id', '=', order.id)
        .where('item_status', '!=', 'CANCELLED')
        .selectAll()
        .execute();

      return { order, items: finalItems };
    });
  }

  async clearTableOrder(tenantId: string, branchId: string, tableId: string) {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
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

        // Cerrar tickets de cocina relacionados
        await trx.updateTable('kitchen_tickets')
          .set({ status: 'DELIVERED', updated_at: new Date() })
          .where('table_order_id', '=', order.id)
          .where('tenant_id', '=', tenantId)
          .where('status', '!=', 'DELIVERED')
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
    return await executeAsTenant(this.db, tenantId, async (trx) => {
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
            created_at: new Date(),
            notes: sourceItem.notes || null,
            sent_to_kitchen_at: sourceItem.sent_to_kitchen_at || null,
            round_id: null,
            seat_number: null,
            item_status: 'PENDING',
            modifiers: null,
            // Pasar un plato de la mesa 4 a la 7 no cambia quién lo pidió.
            source: sourceItem.source,
            course: sourceItem.course
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

  async sendTableOrderToKitchen(tenantId: string, branchId: string, tableId: string) {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      const order = await trx.selectFrom('table_orders')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('table_id', '=', tableId)
        .where('status', '=', 'OPEN')
        .selectAll()
        .executeTakeFirst();

      if (!order) throw new Error('Table order not found or not open');

      // 1. Get current items in the table order
      const currentItems = await trx.selectFrom('table_order_items')
        .where('table_order_id', '=', order.id)
        .selectAll()
        .execute();

      // 2. Get all previously sent items for this table order
      const previousSentItems = await trx.selectFrom('kitchen_tickets as kt')
        .innerJoin('kitchen_ticket_items as kti', 'kti.kitchen_ticket_id', 'kt.id')
        .where('kt.table_order_id', '=', order.id)
        .where('kt.status', '!=', 'VOID') // assuming VOID tickets don't count towards sent items
        .select(['kti.product_id', 'kti.variant_id', 'kti.qty', 'kt.course'])
        .execute();

      // Calculate sent quantities per product/variant/course
      const sentQtyMap = new Map<string, number>();
      for (const item of previousSentItems) {
        const key = `${item.product_id}-${item.variant_id || 'base'}-${item.course}`;
        sentQtyMap.set(key, (sentQtyMap.get(key) || 0) + item.qty);
      }

      // Calculate delta
      const itemsToSend = [];
      for (const item of currentItems) {
        const key = `${item.product_id}-${item.variant_id || 'base'}-${item.course}`;
        const sentQty = sentQtyMap.get(key) || 0;
        const delta = item.qty - sentQty;

        if (delta > 0) {
          itemsToSend.push({ ...item, qtyToSend: delta });
        }
      }

      if (itemsToSend.length === 0) {
        return { order, itemsSent: [] };
      }

      // 3. Create Order Round
      const lastRound = await trx.selectFrom('order_rounds')
        .where('table_order_id', '=', order.id)
        .orderBy('round_number', 'desc')
        .select('round_number')
        .executeTakeFirst();

      const nextRoundNumber = (lastRound?.round_number || 0) + 1;
      const roundId = randomUUID();

      await trx.insertInto('order_rounds')
        .values({
          id: roundId,
          tenant_id: tenantId,
          branch_id: branchId,
          table_order_id: order.id,
          waiter_id: order.waiter_id,
          round_number: nextRoundNumber,
          status: 'PENDING'
        })
        .execute();

      // 4. Create Kitchen Tickets grouped by course
      const itemsByCourse = new Map<number, typeof itemsToSend>();
      for (const item of itemsToSend) {
        const course = item.course;
        if (!itemsByCourse.has(course)) itemsByCourse.set(course, []);
        itemsByCourse.get(course)!.push(item);
      }

      for (const [course, courseItems] of itemsByCourse.entries()) {
        const ticketId = randomUUID();
        await trx.insertInto('kitchen_tickets')
          .values({
            id: ticketId,
            tenant_id: tenantId,
            branch_id: branchId,
            round_id: roundId,
            table_order_id: order.id,
            course,
            status: course === 1 ? 'PENDING' : 'HOLD' // First course is PENDING, others HOLD by default
          })
          .execute();

        const ktiData = courseItems.map(item => ({
          id: randomUUID(),
          tenant_id: tenantId,
          branch_id: branchId,
          kitchen_ticket_id: ticketId,
          table_order_id: order.id,
          product_id: item.product_id,
          variant_id: item.variant_id,
          qty: item.qtyToSend,
          notes: item.notes
        }));

        await trx.insertInto('kitchen_ticket_items')
          .values(ktiData)
          .execute();
      }

      // Update table_order_items to link to round (optional, but good for tracking)
      const now = new Date();
      for (const item of itemsToSend) {
        await trx.updateTable('table_order_items')
          .set({ sent_to_kitchen_at: now, round_id: roundId })
          .where('id', '=', item.id)
          .execute();
      }

      return { order, itemsSent: itemsToSend.map(i => ({ ...i, qty: i.qtyToSend })) };
    });
  }

  async fireTableOrderCourse(tenantId: string, branchId: string, tableId: string, course?: number) {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      const order = await trx.selectFrom('table_orders')
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('table_id', '=', tableId)
        .where('status', '=', 'OPEN')
        .selectAll()
        .executeTakeFirst();

      if (!order) throw new Error('Table order not found or not open');

      let query = trx.updateTable('kitchen_tickets')
        .set({ status: 'PENDING' })
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('table_order_id', '=', order.id)
        .where('status', '=', 'HOLD');
        
      if (course !== undefined) {
        query = query.where('course', '=', course);
      }

      await query.execute();

      return true;
    });
  }
}
