import { z } from 'zod';
import { businessTypeSchema } from './business-type.js';
import { ASSIGNABLE_MODULES, assignableModuleSchema, type AssignableModule } from './entitlements.js';
import { MODULE_DTO_FIELD } from './module-flags.js';

/**
 * Los banderines de módulo del DTO, derivados de la única lista que existe.
 *
 * Estaban escritos a mano dos veces en este archivo —el DTO y los claims— y otras dos en el
 * API. Cuatro copias de lo mismo. `enableGuestsCount` además llevaba `default(true)` y el
 * resto `false`: una asimetría que dejó de significar nada cuando los módulos pasaron a
 * salir del plan (`guests_count` está en PRO y ENTERPRISE, no en STARTER).
 */
type ModuleFlagShape = {
  [M in AssignableModule as (typeof MODULE_DTO_FIELD)[M]]: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
};

const moduleFlagShape = Object.fromEntries(
  ASSIGNABLE_MODULES.map((module) => [MODULE_DTO_FIELD[module], z.boolean().optional().default(false)])
) as ModuleFlagShape;


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
  /** Los módulos resueltos del plan. Es lo que el frontend consume. */
  modules: z.array(assignableModuleSchema).optional().default([]),
  ...moduleFlagShape,
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
  /** Los módulos resueltos del plan. Es lo que el frontend consume. */
  modules: z.array(assignableModuleSchema).optional().default([]),
  ...moduleFlagShape,
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
