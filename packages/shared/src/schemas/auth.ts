import { z } from 'zod';
import { businessTypeSchema } from './business-type.js';

/**
 * Roles de usuario. Esta es la única definición: el tipo `UserRole` del paquete compartido
 * y el del API se derivan de aquí.
 *
 * Estuvieron desincronizados durante meses —el enum de Postgres tenía `WAITER` desde la
 * migración 066, este esquema también, pero el tipo del API y el del frontend no—, y el
 * resultado era que no había forma de crear un mesero por ninguna vía.
 */
export const USER_ROLES = [
  'PLATFORM_OWNER',
  'TENANT_OWNER',
  'ADMIN',
  'MANAGER',
  'CASHIER',
  'AUDITOR',
  'WAITER'
] as const;

export const userRoleSchema = z.enum(USER_ROLES);

/**
 * Roles que un administrador de negocio puede asignar desde la pantalla de usuarios.
 * `PLATFORM_OWNER` queda fuera a propósito: solo la plataforma lo otorga.
 */
export const ASSIGNABLE_USER_ROLES = [
  'TENANT_OWNER',
  'ADMIN',
  'MANAGER',
  'CASHIER',
  'AUDITOR',
  'WAITER'
] as const;
export const tenantTaxModeSchema = z.enum(['IVA', 'INC_RESTAURANT', 'REGIMEN_SIMPLIFICADO']);

export const loginBodySchema = z.object({
  email: z.string().trim().max(254).email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(200),
  tenantId: z.string().uuid().optional()
}).strict();

export const authUserSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().optional().nullable(),
  tenantPlan: z.string().optional().nullable(),
  taxMode: tenantTaxModeSchema.optional().nullable(),
  businessType: businessTypeSchema.optional().nullable(),
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
  enableGuestsCount: z.boolean().optional().default(true),
  enableRestaurant: z.boolean().optional().default(false),
  enableKds: z.boolean().optional().default(false),
  enableInventory: z.boolean().optional().default(false),
  enableFiscal: z.boolean().optional().default(false),
  enableLoyalty: z.boolean().optional().default(false),
  enableAdvancedReports: z.boolean().optional().default(false),
  role: userRoleSchema,
  email: z.string().email(),
  name: z.string().min(1),
  active: z.boolean(),
  branchIds: z.array(z.string().uuid()).optional(),
  permissions: z.array(z.string()).optional(),
  isPlatformRole: z.boolean().optional(),
  isImpersonating: z.boolean().optional()
});

export const loginResponseSchema = z.object({
  accessToken: z.string().min(1).optional(),
  tokenType: z.literal('Bearer').optional(),
  expiresIn: z.string().min(1).optional(),
  user: authUserSchema.optional(),
  requireTenantSelection: z.boolean().optional(),
  tenants: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    business_name: z.string()
  })).optional()
});

export const meResponseSchema = z.object({
  user: authUserSchema
});

export const jwtClaimsSchema = z.object({
  sub: z.string(),
  userId: z.string(),
  tenantId: z.string().uuid().optional().nullable(),
  tenantPlan: z.string().optional().nullable(),
  role: userRoleSchema,
  email: z.string().email(),
  name: z.string().min(1),
  businessType: businessTypeSchema.optional().nullable(),
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
  enableGuestsCount: z.boolean().optional().default(true),
  enableRestaurant: z.boolean().optional().default(false),
  enableKds: z.boolean().optional().default(false),
  enableInventory: z.boolean().optional().default(false),
  enableFiscal: z.boolean().optional().default(false),
  enableLoyalty: z.boolean().optional().default(false),
  enableAdvancedReports: z.boolean().optional().default(false),
  branchIds: z.array(z.string().uuid()).optional(),
  permissions: z.array(z.string()).optional(),
  isPlatformRole: z.boolean().optional(),
  isImpersonating: z.boolean().optional(),
  iat: z.number().int().optional(),
  exp: z.number().int().optional()
});

export type UserRole = z.infer<typeof userRoleSchema>;
export type TenantTaxMode = z.infer<typeof tenantTaxModeSchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type JwtClaims = z.infer<typeof jwtClaimsSchema>;

export type UserRoleInput = z.infer<typeof userRoleSchema>;
export type TenantTaxModeInput = z.infer<typeof tenantTaxModeSchema>;
export type LoginBodyInput = z.infer<typeof loginBodySchema>;
export type AuthUserInput = z.infer<typeof authUserSchema>;
export type LoginResponseInput = z.infer<typeof loginResponseSchema>;
export type MeResponseInput = z.infer<typeof meResponseSchema>;
export type JwtClaimsInput = z.infer<typeof jwtClaimsSchema>;
