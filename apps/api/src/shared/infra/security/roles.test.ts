import { describe, expect, it } from 'vitest';
import { USER_ROLES } from '@pos-dian/shared';
import { ROLE_PERMISSIONS, getPermissionsForRole } from './permissions.js';
import { assertCanManageRole } from './role-guard.js';
import type { UserRole } from './types.js';

/**
 * Los roles vivían escritos a mano en cinco sitios —el enum de Postgres, el esquema
 * compartido, el tipo del API, el tipo del esquema de base y el `z.enum` de la ruta de
 * usuarios— y llevaban meses desincronizados: `WAITER` existía en la base desde la
 * migración 066 pero no en el API, así que no había forma de crear un mesero. Ahora todo
 * se deriva de `USER_ROLES`; estas pruebas cierran la puerta a que vuelva a abrirse un
 * hueco al añadir el próximo rol.
 */
describe('Definición de roles', () => {
  it('todo rol declarado tiene un conjunto de permisos', () => {
    for (const role of USER_ROLES) {
      const permissions = getPermissionsForRole(role as UserRole);
      expect(permissions, `el rol ${role} no tiene permisos definidos`).toBeDefined();
      expect(permissions.length, `el rol ${role} tiene cero permisos: sería una cuenta inservible`).toBeGreaterThan(0);
    }
  });

  it('no hay permisos declarados para roles que no existen', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      expect(USER_ROLES, `${role} tiene permisos pero no es un rol válido`).toContain(role);
    }
  });

  it('un mesero atiende mesas pero no toca caja, catálogo ni usuarios', () => {
    const permissions = getPermissionsForRole('WAITER');

    // Sin `sales:create` la pantalla de Mesas del frontend ni siquiera aparece.
    expect(permissions).toContain('sales:create');
    expect(permissions).toContain('products:view');

    expect(permissions).not.toContain('users:manage');
    expect(permissions).not.toContain('products:manage');
    expect(permissions).not.toContain('sales:void');
    expect(permissions).not.toContain('cash:close');
    expect(permissions).not.toContain('settings:manage');
  });

  it('la jerarquía cubre todos los roles y falla cerrado ante uno desconocido', () => {
    // Un administrador puede gestionar a cualquier rol de piso.
    expect(() => assertCanManageRole('ADMIN', 'WAITER')).not.toThrow();
    expect(() => assertCanManageRole('MANAGER', 'WAITER')).not.toThrow();

    // Entre pares no.
    expect(() => assertCanManageRole('CASHIER', 'WAITER')).toThrow();
    expect(() => assertCanManageRole('WAITER', 'CASHIER')).toThrow();

    // Y un rol que no esté en la tabla de niveles se rechaza en vez de colarse: la
    // comparación numérica contra `undefined` siempre es falsa, así que antes esto pasaba.
    expect(() => assertCanManageRole('ADMIN', 'ROL_INVENTADO' as UserRole)).toThrow();
    expect(() => assertCanManageRole('ROL_INVENTADO' as UserRole, 'CASHIER')).toThrow();
  });
});
