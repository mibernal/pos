import { AppError } from '../../../shared/infra/errors/app-error.js';
import { AuthContext, UserPermission, UserRole } from './types.js';

export const ROLE_PERMISSIONS: Record<UserRole, UserPermission[]> = {
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
    'terminals:view',
    'terminals:manage',
    'settings:manage'
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
    'terminals:view',
    'terminals:manage'
  ],
  CASHIER: [
    'sales:create',
    'returns:create',
    'products:view',
    'customers:view',
    'customers:create',
    'customers:update',
    'cash:open',
    'cash:close',
    'cash:move',
    'terminals:view'
  ],
  AUDITOR: [
    'reports:view',
    'dashboard:view',
    'cash:audit',
    'terminals:view',
    'customers:view',
    'products:view'
  ]
};

export function getPermissionsForRole(role: UserRole): UserPermission[] {
  return ROLE_PERMISSIONS[role] || [];
}

export function ensureUserCanAccessBranch(auth: AuthContext, branchId: string) {
  if (auth.role === 'ADMIN') return; // Admins can access everything
  if (!Array.isArray(auth.branchIds) || !auth.branchIds.includes(branchId)) {
    throw new AppError(403, 'AUTH_FORBIDDEN', 'No tienes acceso a esta sucursal');
  }
}
