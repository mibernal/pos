import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';

export class ListUsersUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(tenantId: string) {
    return this.db.selectFrom('users')
      .where('tenant_id', '=', tenantId)
      .select(['id', 'email', 'name', 'role', 'active', 'created_at'])
      .orderBy('created_at', 'desc')
      .execute();
  }
}
