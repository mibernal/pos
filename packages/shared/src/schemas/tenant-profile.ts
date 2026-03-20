import { z } from 'zod';
import { tenantTaxModeSchema } from './auth.js';

const nullablePhoneSchema = z
  .string()
  .trim()
  .min(7, 'El teléfono debe tener al menos 7 caracteres')
  .max(20, 'El teléfono no puede superar 20 caracteres')
  .regex(/^[0-9+()\-\s]+$/, 'El teléfono solo puede incluir números y símbolos básicos')
  .nullable();
const nullableFooterMessageSchema = z
  .string()
  .trim()
  .min(1)
  .max(180, 'El mensaje final no puede superar 180 caracteres')
  .nullable();

export const tenantProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  nit: z.string().trim().min(1),
  businessName: z.string().trim().min(1),
  address: z.string().trim().min(1),
  phone: nullablePhoneSchema,
  footerMessage: nullableFooterMessageSchema,
  taxMode: tenantTaxModeSchema,
  createdAt: z.string().min(1)
});

export const updateTenantBusinessProfileBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    nit: z.string().trim().min(1).optional(),
    businessName: z.string().trim().min(1).optional(),
    address: z.string().trim().min(1).optional(),
    phone: nullablePhoneSchema.optional(),
    footerMessage: nullableFooterMessageSchema.optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, 'Debes enviar al menos un campo');

export type TenantProfile = z.infer<typeof tenantProfileSchema>;
export type UpdateTenantBusinessProfileBody = z.infer<typeof updateTenantBusinessProfileBodySchema>;

export type TenantProfileInput = z.infer<typeof tenantProfileSchema>;
export type UpdateTenantBusinessProfileBodyInput = z.infer<
  typeof updateTenantBusinessProfileBodySchema
>;
