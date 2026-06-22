import { Waiter, CreateWaiterPayload, UpdateWaiterPayload } from '@pos-dian/shared';
import { WaitersRepository } from '../infra/waiters.repository.js';

export class WaitersService {
  constructor(private waitersRepo: WaitersRepository) {}

  async listWaiters(tenantId: string, branchId: string): Promise<Waiter[]> {
    return await this.waitersRepo.listWaiters(tenantId, branchId);
  }

  async getWaiter(tenantId: string, id: string): Promise<Waiter | null> {
    return await this.waitersRepo.getWaiterById(tenantId, id);
  }

  async createWaiter(tenantId: string, branchId: string, payload: CreateWaiterPayload): Promise<Waiter> {
    return await this.waitersRepo.createWaiter(tenantId, branchId, payload);
  }

  async updateWaiter(tenantId: string, id: string, payload: UpdateWaiterPayload): Promise<Waiter> {
    return await this.waitersRepo.updateWaiter(tenantId, id, payload);
  }
}
