import { UserRole } from './types.js';
import { AppError } from '../errors/app-error.js';

/**
 * Define the hierarchy levels. Higher number means more privileges.
 */
const ROLE_LEVEL: Record<UserRole, number> = {
  PLATFORM_OWNER: 100,
  TENANT_OWNER: 90,
  ADMIN: 80,
  MANAGER: 50,
  AUDITOR: 40,
  CASHIER: 10
};

export function isPlatformRole(role: UserRole): boolean {
  return role === 'PLATFORM_OWNER';
}

export function isSuperRole(role: UserRole): boolean {
  return role === 'PLATFORM_OWNER' || role === 'TENANT_OWNER';
}

/**
 * Validates if `actorRole` is allowed to manage (create/update/delete) `targetRole`.
 */
export function assertCanManageRole(actorRole: UserRole, targetRole: UserRole): void {
  // PLATFORM_OWNER can manage anyone
  if (actorRole === 'PLATFORM_OWNER') {
    return;
  }

  // Nobody else can create/manage a PLATFORM_OWNER
  if (targetRole === 'PLATFORM_OWNER') {
    throw new AppError(403, 'AUTH_FORBIDDEN', 'No tienes permisos para gestionar administradores de plataforma');
  }

  // TENANT_OWNER can manage anyone within the tenant EXCEPT another TENANT_OWNER
  // (Only PLATFORM_OWNER can create or change a TENANT_OWNER)
  if (targetRole === 'TENANT_OWNER') {
    throw new AppError(403, 'AUTH_FORBIDDEN', 'No tienes permisos para asignar el rol de propietario de negocio');
  }

  if (actorRole === 'TENANT_OWNER') {
    return; // Can manage ADMIN, MANAGER, AUDITOR, CASHIER
  }

  // Strict hierarchy for the rest: must be strictly greater level
  if (ROLE_LEVEL[actorRole] <= ROLE_LEVEL[targetRole]) {
    throw new AppError(
      403,
      'AUTH_FORBIDDEN',
      `No tienes suficientes privilegios para gestionar usuarios con rol ${targetRole}`
    );
  }
}

/**
 * Validates that a user is not trying to change their own role or delete themselves
 */
export function assertIsNotSelfRoleChange(actorId: string, targetId: string): void {
  if (actorId === targetId) {
    throw new AppError(403, 'AUTH_FORBIDDEN', 'No puedes modificar tu propio rol ni desactivarte a ti mismo');
  }
}
