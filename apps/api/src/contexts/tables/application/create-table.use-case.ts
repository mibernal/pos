import { TablesRepository } from '../infra/tables.repository.js';
import { CreateTablePayload, Table } from '@pos-dian/shared';

export class CreateTableUseCase {
  constructor(private readonly tablesRepo: TablesRepository) {}

  async execute(tenantId: string, branchId: string, roomId: string, payload: CreateTablePayload): Promise<Table> {
    return this.tablesRepo.createTable(tenantId, branchId, roomId, payload);
  }
}
