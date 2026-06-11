import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';

export class GetPlansUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute() {
    return this.db.selectFrom('billing_plans')
      .where('archived_at', 'is', null)
      .selectAll()
      .execute();
  }
}
