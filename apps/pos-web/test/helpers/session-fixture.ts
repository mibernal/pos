import { moduleFlags, modulesFromFlags, type AssignableModule } from '@pos-dian/shared';
import type { AuthSession } from '../../src/lib/api';

type AuthUser = AuthSession['user'];

/**
 * Construye un `AuthUser` completo para tests.
 *
 * Los banderines de módulo salen de `moduleFlags`, la misma función que usa el API: aquí
 * había una cuarta copia de la lista de veintiún módulos, y añadir uno obligaba a tocarla.
 *
 * Una prueba que pide `enableTables: true` sigue significando lo mismo: `modules` se deriva
 * de los banderines que la prueba puso, con la misma función que usa la aplicación. Y una
 * prueba puede pedir `modules` directamente, que es como habla el DTO desde la fase 11.
 */
export function buildAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  const base = {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    taxMode: 'IVA' as const,
    role: 'ADMIN' as const,
    email: 'admin@demo.posdian.local',
    name: 'Admin Demo',
    active: true,
    ...moduleFlags([]),
    ...overrides
  };

  return {
    ...base,
    modules: overrides.modules ?? (modulesFromFlags(base) as AssignableModule[])
  } as AuthUser;
}
