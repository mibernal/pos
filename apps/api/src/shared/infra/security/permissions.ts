import { AppError } from '../../../shared/infra/errors/app-error.js';
import { AuthContext, UserPermission, UserRole } from './types.js';

export const ROLE_PERMISSIONS: Record<UserRole, UserPermission[]> = {
  PLATFORM_OWNER: [
    'platform:tenants:create',
    'platform:tenants:suspend',
    'platform:tenants:activate',
    'platform:plans:manage',
    'platform:metrics:view',
    'platform:impersonate',
    'users:manage'
  ],
  TENANT_OWNER: [
    'sales:create',
    'sales:void',
    'returns:create',
    'inventory:adjust',
    'inventory:transfer',
    'inventory:receive',
    'products:view',
    'products:manage',
    'customers:view',
    'customers:create',
    'customers:update',
    'cash:open',
    'cash:close',
    'cash:move',
    'cash:reconcile',
    'cash:audit',
    'reports:view',
    'dashboard:view',
    'dashboard:global:view',
    'sales:view',
    'inventory:view',
    'terminals:view',
    'terminals:manage',
    'settings:manage',
    'users:manage',
    'branches:manage',
    'branches:view',
    'alerts:view',
    'alerts:manage',
    'audit:view',
    'tenant:settings:manage',
    'tenant:owner:manage'
  ],
  ADMIN: [
    'sales:create',
    'sales:void',
    'returns:create',
    'inventory:adjust',
    'inventory:transfer',
    'inventory:receive',
    'products:view',
    'products:manage',
    'customers:view',
    'customers:create',
    'customers:update',
    'cash:open',
    'cash:close',
    'cash:move',
    'cash:reconcile',
    'cash:audit',
    'reports:view',
    'dashboard:view',
    'dashboard:global:view',
    'sales:view',
    'inventory:view',
    'terminals:view',
    'terminals:manage',
    'settings:manage',
    'users:manage',
    'branches:manage',
    'branches:view',
    'alerts:view',
    'alerts:manage',
    'audit:view'
  ],
  MANAGER: [
    'sales:create',
    'sales:void',
    'returns:create',
    'inventory:receive',
    'inventory:transfer',
    'inventory:adjust',
    'products:view',
    'products:manage',
    'customers:view',
    'customers:create',
    'customers:update',
    'cash:open',
    'cash:close',
    'cash:move',
    'cash:reconcile',
    'cash:audit',
    'reports:view',
    'dashboard:view',
    'sales:view',
    'inventory:view',
    'terminals:view',
    'users:manage',
    'branches:view',
    'alerts:view',
    'alerts:manage',
    'audit:view'
  ],
  CASHIER: [
    'sales:create',
    'sales:view',
    'returns:create',
    'inventory:view',
    'products:view',
    'customers:view',
    'customers:create',
    'customers:update',
    'cash:open',
    'cash:close',
    'cash:move',
    'terminals:view',
    'branches:view'
  ],
  AUDITOR: [
    'reports:view',
    'dashboard:view',
    'cash:audit',
    'terminals:view',
    'customers:view',
    'sales:view',
    'inventory:view',
    'products:view',
    'branches:view',
    'alerts:view',
    'audit:view'
  ]
};

export function getPermissionsForRole(role: UserRole): UserPermission[] {
  return ROLE_PERMISSIONS[role] || [];
}

export function ensureUserCanAccessBranch(auth: AuthContext | null, branchId: string) {
  if (!auth) throw new AppError(401, 'UNAUTHORIZED', 'No has iniciado sesión');
  if (auth.isPlatformRole) return; // Platform owners can access anything
  if (auth.role === 'ADMIN' || auth.role === 'TENANT_OWNER') return; // Tenant admins can access everything in their tenant
  if (!Array.isArray(auth.branchIds) || !auth.branchIds.includes(branchId)) {
    throw new AppError(403, 'AUTH_FORBIDDEN', 'No tienes acceso a esta sucursal');
  }
}
