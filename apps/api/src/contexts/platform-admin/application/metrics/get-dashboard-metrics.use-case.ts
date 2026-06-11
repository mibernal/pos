import { PlatformAdminRepository } from '../../infra/platform-admin.repository.js';

export class GetDashboardMetricsUseCase {
  constructor(private readonly repository: PlatformAdminRepository) {}

  async execute() {
    return this.repository.getDashboardMetrics();
  }
}
