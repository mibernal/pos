import { BaseDomainEvent } from '../../../../shared/domain/events/DomainEvent.js';

export interface SaleCreatedPayload {
  sale_id: string;
  tenant_id: string;
  branch_id: string;
  cash_session_id: string | null;
  sale_number: number;
  total_cents: number;
}

export class SaleCreatedEvent extends BaseDomainEvent<SaleCreatedPayload> {
  constructor(payload: SaleCreatedPayload, aggregateId: string, branchId?: string) {
    super('sale.created', 1, aggregateId, 'SALE', payload, branchId);
  }
}
