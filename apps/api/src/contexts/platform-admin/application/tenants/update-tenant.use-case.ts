import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { UpdateTenantCommand } from '../../domain/platform-admin.types.js';

export class UpdateTenantUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(tenantId: string, payload: UpdateTenantCommand, actorId: string, actorEmail: string) {
    const { owner_name, owner_email, ...tenantData } = payload;

    if (Object.keys(tenantData).length > 0) {
      await this.db.updateTable('tenants')
        .set(tenantData)
        .where('id', '=', tenantId)
        .execute();
    }

    if (owner_name || owner_email) {
      const tenant = await this.db.selectFrom('tenants').where('id', '=', tenantId).selectAll().executeTakeFirst();
      if (tenant?.owner_user_id) {
        const updateData: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (owner_name) updateData.name = owner_name;
        if (owner_email) updateData.email = owner_email;
        
        await this.db.updateTable('users')
          .set(updateData)
          .where('id', '=', tenant.owner_user_id)
          .execute();
      }
    }

    await this.db.insertInto('platform_events').values({
      tenant_id: tenantId,
      type: 'TENANT_UPDATED',
      severity: 'INFO',
      actor_id: actorId,
      actor_email: actorEmail,
      metadata: payload as any // eslint-disable-line @typescript-eslint/no-explicit-any
    }).execute();
  }
}
