import { BaseDomainEvent } from '../../../../shared/domain/events/DomainEvent.js';

export interface SaleCreatedPayload {
  sale_id: string;
  tenant_id: string;
  branch_id: string;
  cash_session_id: string | null;
  sale_number: number;
  total_cents: number;
  table_order_id?: string | null;
  audit_payload?: {
    client_uuid: string;
    items_count: number;
    subtotal_cents: number;
    discount_cents: number;
    tax_total_cents: number;
    payment_mode: string;
  };
}

export class SaleCreatedEvent extends BaseDomainEvent<SaleCreatedPayload> {
  constructor(payload: SaleCreatedPayload, aggregateId: string, branchId?: string) {
    super('sale.created', 1, aggregateId, 'SALE', payload, branchId);
  }
}
