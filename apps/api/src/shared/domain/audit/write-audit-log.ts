import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../infra/db/schema.js';
import { getAuditContext } from '../../infra/audit/audit-context.js';

type AuditLogDb = Pick<Kysely<Database>, 'insertInto'>;

export interface AuditLogInput {
  tenantId: string;
  branchId?: string | null;
  userId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  payloadJson: Record<string, unknown>;
}

export async function writeAuditLog(db: AuditLogDb, input: AuditLogInput): Promise<void> {
  const context = getAuditContext();

  await db
    .insertInto('audit_logs')
    .values({
      id: randomUUID(),
      tenant_id: input.tenantId,
      branch_id: input.branchId ?? null,
      user_id: input.userId ?? null,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      legacy_payload: input.payloadJson,
      ip_address: context?.ipAddress || null,
      user_agent: context?.userAgent || null,
      correlation_id: context?.correlationId || null
    })
    .execute();
}
