import { KdsRepository } from '../infra/kds.repository.js';
import { KitchenTicketWithItems } from '@pos-dian/shared';

export class KdsService {
  constructor(private kdsRepo: KdsRepository) {}

  async getActiveTickets(tenantId: string, branchId: string): Promise<KitchenTicketWithItems[]> {
    return await this.kdsRepo.getActiveTickets(tenantId, branchId);
  }

  async updateTicketStatus(tenantId: string, ticketId: string, status: string): Promise<void> {
    await this.kdsRepo.updateTicketStatus(tenantId, ticketId, status);
  }
}
