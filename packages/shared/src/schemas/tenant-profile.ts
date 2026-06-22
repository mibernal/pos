import { z } from 'zod';
import { tenantTaxModeSchema } from './auth.js';
import { businessTypeSchema } from './business-type.js';

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
  businessType: businessTypeSchema.nullable(),
  customBusinessType: z.string().trim().min(2).max(80).nullable().optional(),
  enableTables: z.boolean().optional().default(false),
  enableDelivery: z.boolean().optional().default(false),
  enableWaiters: z.boolean().optional().default(false),
  enableSplitBill: z.boolean().optional().default(false),
  enableTips: z.boolean().optional().default(false),
  enableKitchen: z.boolean().optional().default(false),
  enableKitchenDisplay: z.boolean().optional().default(false),
  enableKitchenTickets: z.boolean().optional().default(false),
  enableKitchenPrinting: z.boolean().optional().default(false),
  enableOrderRounds: z.boolean().optional().default(false),
  enableProductModifiers: z.boolean().optional().default(false),
  enableReservations: z.boolean().optional().default(false),
  enableWaiterShifts: z.boolean().optional().default(false),
  enableQrMenu: z.boolean().optional().default(false),
  createdAt: z.string().min(1)
});

export const updateTenantBusinessProfileBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    nit: z.string().trim().min(1).optional(),
    businessName: z.string().trim().min(1).optional(),
    address: z.string().trim().min(1).optional(),
    phone: nullablePhoneSchema.optional(),
    footerMessage: nullableFooterMessageSchema.optional(),
    businessType: businessTypeSchema.optional(),
    customBusinessType: z.string().trim().min(2).max(80).nullable().optional(),
    enableTables: z.boolean().optional(),
    enableDelivery: z.boolean().optional(),
    enableWaiters: z.boolean().optional(),
    enableSplitBill: z.boolean().optional(),
    enableTips: z.boolean().optional(),
    enableKitchen: z.boolean().optional(),
    enableKitchenDisplay: z.boolean().optional(),
    enableKitchenTickets: z.boolean().optional(),
    enableKitchenPrinting: z.boolean().optional(),
    enableOrderRounds: z.boolean().optional(),
    enableProductModifiers: z.boolean().optional(),
    enableReservations: z.boolean().optional(),
    enableWaiterShifts: z.boolean().optional(),
    enableQrMenu: z.boolean().optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, 'Debes enviar al menos un campo');

export type TenantProfile = z.infer<typeof tenantProfileSchema>;
export type UpdateTenantBusinessProfileBody = z.infer<typeof updateTenantBusinessProfileBodySchema>;

export type TenantProfileInput = z.infer<typeof tenantProfileSchema>;
export type UpdateTenantBusinessProfileBodyInput = z.infer<
  typeof updateTenantBusinessProfileBodySchema
>;
