import { TableOrdersRepository } from '../infra/table-orders.repository.js';

export class ClearTableOrderUseCase {
  constructor(private readonly repo: TableOrdersRepository) {}

  async execute(tenantId: string, branchId: string, tableId: string): Promise<void> {
    await this.repo.clearTableOrder(tenantId, branchId, tableId);
  }
}
