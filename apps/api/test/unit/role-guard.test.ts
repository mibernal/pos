import { test, expect, describe } from 'vitest';
import { assertCanManageRole, assertIsNotSelfRoleChange } from '../../../src/shared/infra/security/role-guard.js';

describe('Role Hierarchy Guard', () => {
  test('PLATFORM_OWNER can manage any role', () => {
    expect(() => assertCanManageRole('PLATFORM_OWNER', 'TENANT_OWNER')).not.toThrow();
    expect(() => assertCanManageRole('PLATFORM_OWNER', 'ADMIN')).not.toThrow();
    expect(() => assertCanManageRole('PLATFORM_OWNER', 'CASHIER')).not.toThrow();
  });

  test('TENANT_OWNER can manage ADMIN and below', () => {
    expect(() => assertCanManageRole('TENANT_OWNER', 'ADMIN')).not.toThrow();
    expect(() => assertCanManageRole('TENANT_OWNER', 'MANAGER')).not.toThrow();
    expect(() => assertCanManageRole('TENANT_OWNER', 'CASHIER')).not.toThrow();
  });

  test('TENANT_OWNER CANNOT manage another TENANT_OWNER or PLATFORM_OWNER', () => {
    expect(() => assertCanManageRole('TENANT_OWNER', 'PLATFORM_OWNER')).toThrow(/No tienes permisos para gestionar administradores de plataforma/);
    expect(() => assertCanManageRole('TENANT_OWNER', 'TENANT_OWNER')).toThrow(/No tienes permisos para asignar el rol de propietario de negocio/);
  });

  test('ADMIN can manage MANAGER, AUDITOR, CASHIER', () => {
    expect(() => assertCanManageRole('ADMIN', 'MANAGER')).not.toThrow();
    expect(() => assertCanManageRole('ADMIN', 'AUDITOR')).not.toThrow();
    expect(() => assertCanManageRole('ADMIN', 'CASHIER')).not.toThrow();
  });

  test('ADMIN CANNOT manage ADMIN, TENANT_OWNER, PLATFORM_OWNER', () => {
    expect(() => assertCanManageRole('ADMIN', 'ADMIN')).toThrow(/No tienes suficientes privilegios/);
    expect(() => assertCanManageRole('ADMIN', 'TENANT_OWNER')).toThrow(/No tienes permisos para asignar el rol de propietario de negocio/);
    expect(() => assertCanManageRole('ADMIN', 'PLATFORM_OWNER')).toThrow(/No tienes permisos para gestionar administradores de plataforma/);
  });

  test('MANAGER can manage CASHIER', () => {
    expect(() => assertCanManageRole('MANAGER', 'CASHIER')).not.toThrow();
  });

  test('MANAGER CANNOT manage AUDITOR or above', () => {
    expect(() => assertCanManageRole('MANAGER', 'AUDITOR')).toThrow(/No tienes suficientes privilegios/);
    expect(() => assertCanManageRole('MANAGER', 'MANAGER')).toThrow(/No tienes suficientes privilegios/);
    expect(() => assertCanManageRole('MANAGER', 'ADMIN')).toThrow(/No tienes suficientes privilegios/);
  });

  test('CASHIER CANNOT manage anyone', () => {
    expect(() => assertCanManageRole('CASHIER', 'CASHIER')).toThrow(/No tienes suficientes privilegios/);
  });
});

describe('Self Role Guard', () => {
  test('User cannot change their own role', () => {
    expect(() => assertIsNotSelfRoleChange('user-1', 'user-1')).toThrow(/No puedes modificar tu propio rol/);
  });

  test('User can change someone else', () => {
    expect(() => assertIsNotSelfRoleChange('user-1', 'user-2')).not.toThrow();
  });
});
