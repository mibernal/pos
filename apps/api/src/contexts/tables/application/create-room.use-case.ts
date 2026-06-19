import { TablesRepository } from '../infra/tables.repository.js';
import { CreateRoomPayload, Room } from '@pos-dian/shared';

export class CreateRoomUseCase {
  constructor(private readonly tablesRepo: TablesRepository) {}

  async execute(tenantId: string, branchId: string, payload: CreateRoomPayload): Promise<Room> {
    return this.tablesRepo.createRoom(tenantId, branchId, payload);
  }
}
