import { PlatformAdminRepository } from '../../infra/platform-admin.repository.js';

export class SearchTenantsUseCase {
  constructor(private readonly repository: PlatformAdminRepository) {}

  async execute({ query, status, plan, activity, limit = 50, offset = 0 }: { query?: string; status?: string; plan?: string; activity?: string; limit?: number; offset?: number }) {
    return this.repository.searchTenants({ query, status, plan, activity, limit, offset });
  }
}
