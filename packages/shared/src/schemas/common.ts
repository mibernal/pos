import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const tenantScopedSchema = z.object({
  tenantId: uuidSchema,
  createdAt: z.string().datetime()
});

export const branchScopedSchema = z.object({
  branchId: uuidSchema
});
