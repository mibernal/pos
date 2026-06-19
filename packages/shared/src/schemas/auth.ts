import { z } from 'zod';
import { businessTypeSchema } from './business-type.js';

export const userRoleSchema = z.enum(['PLATFORM_OWNER', 'TENANT_OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR']);
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
