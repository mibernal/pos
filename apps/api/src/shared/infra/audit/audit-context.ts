import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditContext {
  correlationId: string;
  ipAddress?: string;
  userAgent?: string;
}

export const auditContextStorage = new AsyncLocalStorage<AuditContext>();

export function getAuditContext(): AuditContext | undefined {
  return auditContextStorage.getStore();
}
