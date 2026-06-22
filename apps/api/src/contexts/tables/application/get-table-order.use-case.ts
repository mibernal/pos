import { TableOrdersRepository } from '../infra/table-orders.repository.js';
import { TableOrderWithItems } from '@pos-dian/shared';

export class GetTableOrderUseCase {
  constructor(private readonly repo: TableOrdersRepository) {}

  async execute(tenantId: string, branchId: string, tableId: string): Promise<TableOrderWithItems | null> {
    const result = await this.repo.getTableOrder(tenantId, branchId, tableId);
    if (!result) return null;

    return {
      order: {
        id: result.order.id,
        tenantId: result.order.tenant_id,
        branchId: result.order.branch_id,
        tableId: result.order.table_id,
        status: result.order.status,
        subtotalCents: result.order.subtotal_cents,
        discountCents: result.order.discount_cents,
        totalCents: result.order.total_cents,
        waiterId: result.order.waiter_id,
        guestsCount: result.order.guests_count,
        orderType: result.order.order_type,
        createdAt: result.order.created_at.toISOString(),
        updatedAt: result.order.updated_at.toISOString()
      },
      items: result.items.map(item => ({
        id: item.id,
        productId: item.product_id,
        variantId: item.variant_id,
        qty: item.qty,
        priceCents: item.price_cents,
        lineTotalCents: item.line_total_cents
      }))
    };
  }
}
