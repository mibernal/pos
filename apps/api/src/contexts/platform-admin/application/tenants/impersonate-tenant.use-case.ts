import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import { randomUUID } from 'crypto';
import { writeAuditLog } from '../../../../shared/domain/audit/write-audit-log.js';

export class ImpersonateTenantUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(tenantId: string, reason: string, actorId: string) {
    const tenant = await this.db.selectFrom('tenants').where('id', '=', tenantId).selectAll().executeTakeFirst();
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant no encontrado');
    
    let owner = null;
    if (tenant.owner_user_id) {
        owner = await this.db.selectFrom('users').where('id', '=', tenant.owner_user_id).selectAll().executeTakeFirst();
    }
    
    if (!owner || !owner.active) {
        owner = await this.db.selectFrom('users').where('tenant_id', '=', tenantId).where('active', '=', true).selectAll().executeTakeFirst();
    }

    if (!owner) {
        throw new AppError(400, 'BAD_REQUEST', 'El tenant no tiene usuarios activos a quienes suplantar');
    }

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.db.insertInto('impersonation_sessions').values({
      id: sessionId,
      platform_user_id: actorId,
      target_user_id: owner.id,
      target_tenant_id: tenantId,
      reason,
      expires_at: expiresAt
    }).execute();

    await writeAuditLog(this.db, {
      tenantId,
      userId: actorId,
      entityType: 'USER',
      entityId: owner.id,
      action: 'USER_IMPERSONATED',
      payloadJson: { session_id: sessionId, reason }
    });

    return sessionId;
  }
}
