import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { UpdateTenantUserCommand } from '../../domain/platform-admin.types.js';

export class UpdateUserUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(tenantId: string, userId: string, payload: UpdateTenantUserCommand, actorId: string, actorEmail: string) {
    if (Object.keys(payload).length > 0) {
      await this.db.updateTable('users')
        .set(payload)
        .where('id', '=', userId)
        .where('tenant_id', '=', tenantId)
        .execute();
    }

    await this.db.insertInto('platform_events').values({
      tenant_id: tenantId,
      type: 'TENANT_USER_UPDATED' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      severity: 'INFO',
      actor_id: actorId,
      actor_email: actorEmail,
      metadata: { userId, updates: payload }
    }).execute();
  }
}
