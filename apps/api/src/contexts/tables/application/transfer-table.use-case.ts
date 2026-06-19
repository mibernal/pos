import { TableOrdersRepository } from '../infra/table-orders.repository.js';
import { TransferTablePayload } from '@pos-dian/shared';

export class TransferTableUseCase {
  constructor(private readonly repo: TableOrdersRepository) {}

  async execute(tenantId: string, branchId: string, sourceTableId: string, payload: TransferTablePayload, userId: string): Promise<void> {
    if (sourceTableId === payload.destinationTableId) {
      throw new Error('Cannot transfer to the same table');
    }
    
    await this.repo.transferTableOrder(tenantId, branchId, sourceTableId, payload, userId);
  }
}
