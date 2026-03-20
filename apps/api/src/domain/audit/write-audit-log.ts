import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../infra/db/schema.js';

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
      payload_json: input.payloadJson
    })
    .execute();
}
