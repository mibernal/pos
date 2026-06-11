import { PlatformAdminRepository } from '../../infra/platform-admin.repository.js';

export class GetRecentActivityUseCase {
  constructor(private readonly repository: PlatformAdminRepository) {}

  async execute(limit: number = 50) {
    return this.repository.getRecentActivity(limit);
  }
}
