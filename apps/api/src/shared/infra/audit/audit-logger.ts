import { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { getAuditContext } from './audit-context.js';
import type { Database } from '../db/schema.js';

export interface AuditLogOptions {
  db: Kysely<Database>;
  tenantId: string;
  userId?: string | null;
  branchId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  oldValues?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  newValues?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function logAudit(options: AuditLogOptions): Promise<void> {
  const context = getAuditContext();

  await options.db
    .insertInto('audit_logs')
    .values({
      id: randomUUID(),
      tenant_id: options.tenantId,
      branch_id: options.branchId || null,
      user_id: options.userId || null,
      entity_type: options.entityType,
      entity_id: options.entityId,
      action: options.action,
      legacy_payload: {}, // Fallback vacio para la migración
      old_values: options.oldValues ? JSON.stringify(options.oldValues) : null,
      new_values: options.newValues ? JSON.stringify(options.newValues) : null,
      ip_address: context?.ipAddress || null,
      user_agent: context?.userAgent || null,
      correlation_id: context?.correlationId || null
    })
    .execute();
}
