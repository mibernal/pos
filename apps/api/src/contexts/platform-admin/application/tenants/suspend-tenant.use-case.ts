import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import { writeAuditLog } from '../../../../shared/domain/audit/write-audit-log.js';

export class SuspendTenantUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(tenantId: string, reason: string, actorId: string, actorEmail: string) {
    const tenant = await this.db.selectFrom('tenants').where('id', '=', tenantId).selectAll().executeTakeFirst();
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant no encontrado');

    await this.db.updateTable('tenants')
      .set({
        status: 'SUSPENDED',
        suspended_at: new Date(),
        suspended_reason: reason
      })
      .where('id', '=', tenantId)
      .execute();

    await writeAuditLog(this.db, {
      tenantId,
      userId: actorId,
      entityType: 'TENANT',
      entityId: tenantId,
      action: 'TENANT_SUSPENDED',
      payloadJson: { reason }
    });

    await this.db.insertInto('platform_events').values({
      tenant_id: tenantId,
      type: 'TENANT_SUSPENDED',
      severity: 'WARNING',
      actor_id: actorId,
      actor_email: actorEmail,
      metadata: { reason } as any // eslint-disable-line @typescript-eslint/no-explicit-any
    }).execute();
  }
}
