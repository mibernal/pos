import { z } from 'zod';

export const alertSeveritySchema = z.enum(['INFO', 'WARNING', 'CRITICAL']);
export const alertStatusSchema = z.enum(['UNREAD', 'READ', 'RESOLVED']);

export const tenantAlertSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid().nullable(),
  type: z.string(),
  severity: alertSeveritySchema,
  title: z.string(),
  message: z.string(),
  metadata: z.any().nullable(),
  status: alertStatusSchema,
  created_at: z.string().datetime({ offset: true }),
  resolved_at: z.string().datetime({ offset: true }).nullable(),
  resolved_by_user_id: z.string().uuid().nullable()
});

export const getAlertsQuerySchema = z.object({
  branch_id: z.string().uuid().optional(),
  status: alertStatusSchema.optional(),
  severity: alertSeveritySchema.optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0)
});

export const resolveAlertSchema = z.object({
  resolution_notes: z.string().optional()
});

export type TenantAlert = z.infer<typeof tenantAlertSchema>;
export type GetAlertsQuery = z.infer<typeof getAlertsQuerySchema>;
export type ResolveAlert = z.infer<typeof resolveAlertSchema>;
