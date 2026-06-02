import { BaseDomainEvent } from '../../../../shared/domain/events/DomainEvent.js';

export interface StockLowPayload {
  product_id: string;
  variant_id: string | null;
  branch_id: string;
  current_qty: number;
  min_stock_alert_qty: number;
  sale_id: string;
}

export class StockLowEvent extends BaseDomainEvent<StockLowPayload> {
  constructor(payload: StockLowPayload, aggregateId: string, branchId: string) {
    super('LOW_STOCK_ALERT', 1, aggregateId, 'INVENTORY', payload, branchId);
  }
}
