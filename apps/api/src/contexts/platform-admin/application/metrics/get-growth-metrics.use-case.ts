import { PlatformAdminRepository } from '../../infra/platform-admin.repository.js';

export class GetGrowthMetricsUseCase {
  constructor(private readonly repository: PlatformAdminRepository) {}

  async execute() {
    return this.repository.getGrowthMetrics();
  }
}
