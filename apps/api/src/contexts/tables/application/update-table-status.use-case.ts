import { TablesRepository } from '../infra/tables.repository.js';
import { UpdateTableStatusPayload, Table } from '@pos-dian/shared';

export class UpdateTableStatusUseCase {
  constructor(private readonly tablesRepo: TablesRepository) {}

  async execute(tenantId: string, branchId: string, tableId: string, payload: UpdateTableStatusPayload): Promise<Table> {
    return this.tablesRepo.updateTableStatus(tenantId, branchId, tableId, payload);
  }
}
