import { AppError } from '../../infra/errors/app-error.js';
import type { Database } from '../../infra/db/schema.js';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { CreateReturnRequest } from '@pos-dian/shared';
import { randomUUID } from 'crypto';


interface ReturnServiceContext {
  db: Kysely<Database>;
  tenantId: string;
  userId: string;
  branchId: string;
}

export async function processPartialReturn(
  ctx: ReturnServiceContext,
  saleId: string,
  request: CreateReturnRequest
) {
  return await ctx.db.transaction().execute(async (trx) => {
    // 1. Lock the sale
    const sale = await trx
      .selectFrom('sales')
      .selectAll()
      .where('id', '=', saleId)
      .where('tenant_id', '=', ctx.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!sale) {
      throw new AppError(404, 'SALE_NOT_FOUND', 'Venta no encontrada');
    }
    if (sale.status === 'VOID') {
      throw new AppError(400, 'SALE_ALREADY_VOIDED', 'No se puede devolver ítems de una venta anulada');
    }

    // 2. Fetch sale items
    const saleItems = await trx
      .selectFrom('sale_items')
      .selectAll()
      .where('sale_id', '=', saleId)
      .execute();

    // 3. Fetch existing returns to calculate available quantities
    const existingReturnItems = await trx
      .selectFrom('return_items')
      .innerJoin('sale_returns', 'sale_returns.id', 'return_items.return_id')
      .select(['return_items.product_id', 'return_items.qty'])
      .where('sale_returns.sale_id', '=', saleId)
      .execute();

    const returnedQtyByProduct = new Map<string, number>();
    for (const er of existingReturnItems) {
      const current = returnedQtyByProduct.get(er.product_id) ?? 0;
      returnedQtyByProduct.set(er.product_id, current + Number(er.qty));
    }

    let totalRefundCents = 0;
    const itemsToInsert: Array<{ product_id: string; qty: string; refund_cents: number }> = [];

    // 4. Validate requested return items
    for (const returnReq of request.items) {
      const soldItem = saleItems.find((i) => i.product_id === returnReq.product_id);
      if (!soldItem) {
        throw new AppError(400, 'PRODUCT_NOT_IN_SALE', `El producto ${returnReq.product_id} no es parte de la venta`);
      }

      const previouslyReturned = returnedQtyByProduct.get(returnReq.product_id) ?? 0;
      const soldQty = Number(soldItem.qty);
      const availableToReturn = soldQty - previouslyReturned;

      if (returnReq.qty > availableToReturn) {
        throw new AppError(
          400,
          'INVALID_RETURN_QTY',
          `No puedes devolver ${returnReq.qty} unidades del producto ${returnReq.product_id}. Solo hay ${availableToReturn} disponibles.`
        );
      }

      // Calculate prorated refund
      // We assume strict linear proportion for simple partial returns.
      // E.g., if sold 2 for 200 cents, returning 1 refunds 100 cents.
      const unitPriceCents = Math.round(soldItem.line_total_cents / soldQty);
      const refundCents = unitPriceCents * returnReq.qty;
      totalRefundCents += refundCents;

      itemsToInsert.push({
        product_id: returnReq.product_id,
        qty: returnReq.qty.toString(),
        refund_cents: refundCents
      });
    }

    // 5. Insert Sale Return
    const returnRow = await trx
      .insertInto('sale_returns')
      .values({
        id: randomUUID(),
        tenant_id: ctx.tenantId,
        sale_id: saleId,
        created_by_user_id: ctx.userId,
        total_refund_cents: totalRefundCents,
        reason: request.reason || null
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // 6. Insert Return Items
    const returnItemsData = itemsToInsert.map((item) => ({
      id: randomUUID(),
      tenant_id: ctx.tenantId,
      return_id: returnRow.id,
      ...item
    }));

    await trx.insertInto('return_items').values(returnItemsData).execute();

    // 7. Adjust Inventory (Add items back)
    for (const item of itemsToInsert) {
      // Create transaction
      await trx
        .insertInto('inventory_transactions')
        .values({
          id: randomUUID(),
          tenant_id: ctx.tenantId,
          branch_id: sale.branch_id,
          product_id: item.product_id,
          operation: 'SALE_RETURN',
          reference_id: returnRow.id,
          qty_change: item.qty, // positive value adds to inventory
          created_by_user_id: ctx.userId,
          notes: `Devolución parcial de venta ${sale.sale_number}`
        })
        .execute();

      // Update balance
      await trx
        .insertInto('inventory_balances')
        .values({
          tenant_id: ctx.tenantId,
          branch_id: sale.branch_id,
          product_id: item.product_id,
          qty: item.qty
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'branch_id', 'product_id']).doUpdateSet({
            qty: sql`inventory_balances.qty + EXCLUDED.qty`,
            updated_at: new Date()
          })
        )
        .execute();
    }

    // 8. Create Outbox Event for DIAN Credit Note
    const outboxPayload = {
      return_id: returnRow.id,
      sale_id: saleId,
      items: itemsToInsert,
      reason: request.reason,
      total_refund_cents: totalRefundCents
    };

    await trx
      .insertInto('outbox_events')
      .values({
        id: randomUUID(),
        tenant_id: ctx.tenantId,
        type: 'sale_returned',
        aggregate_id: returnRow.id,
        payload_json: outboxPayload,
        status: 'PENDING'
      })
      .execute();

    return {
      return_id: returnRow.id,
      total_refund_cents: totalRefundCents,
      status: 'success',
      message: 'Devolución parcial procesada exitosamente'
    };
  });
}
