import { z } from 'zod';

export const documentTypeSchema = z.enum(['CC', 'CE', 'NIT', 'PASSPORT']);

export const customerSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  document_type: documentTypeSchema,
  document_number: z.string().min(1).max(32),
  name: z.string().min(1),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export type Customer = z.infer<typeof customerSchema>;

export const createCustomerBodySchema = z.object({
  document_type: documentTypeSchema,
  document_number: z.string().min(1).max(32),
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable()
});

export type CreateCustomerInput = z.infer<typeof createCustomerBodySchema>;

export const updateCustomerBodySchema = createCustomerBodySchema.partial();

export type UpdateCustomerInput = z.infer<typeof updateCustomerBodySchema>;

export const customerIdParamsSchema = z.object({
  id: z.string().uuid()
});
