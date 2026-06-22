import { TablesRepository } from '../infra/tables.repository.js';
import { Table, UpdateTableWaiterPayload } from '@pos-dian/shared';

export class AssignTableWaiterUseCase {
  constructor(private readonly tablesRepository: TablesRepository) {}

  async execute(
    tenantId: string,
    branchId: string,
    tableId: string,
    payload: UpdateTableWaiterPayload
  ): Promise<Table> {
    return this.tablesRepository.assignWaiter(tenantId, branchId, tableId, payload.waiterId);
  }
}
