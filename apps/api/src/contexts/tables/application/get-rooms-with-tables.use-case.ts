import { TablesRepository } from '../infra/tables.repository.js';
import { RoomWithTables } from '@pos-dian/shared';

export class GetRoomsWithTablesUseCase {
  constructor(private readonly tablesRepo: TablesRepository) {}

  async execute(tenantId: string, branchId: string): Promise<RoomWithTables[]> {
    return this.tablesRepo.getRoomsWithTables(tenantId, branchId);
  }
}
