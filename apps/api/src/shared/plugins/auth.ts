import jwt from '@fastify/jwt';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { AuthContext, JwtClaims, UserRole, UserPermission } from '../infra/security/types.js'; // eslint-disable-line @typescript-eslint/no-unused-vars
import { env } from '../../app/env.js';
import { AppError } from '../infra/errors/app-error.js';

function mapClaimsToAuthContext(claims: JwtClaims): AuthContext {
  return {
    userId: claims.userId,
    tenantId: claims.tenantId,
    tenantPlan: claims.tenantPlan,
    role: claims.role,
    email: claims.email,
    name: claims.name,
    branchIds: claims.branchIds,
    permissions: claims.permissions,
    isPlatformRole: claims.isPlatformRole ?? false,
    isImpersonating: claims.isImpersonating ?? false,
    businessType: claims.businessType,
    enableRestaurant: claims.enableRestaurant,
    enableKds: claims.enableKds,
    enableInventory: claims.enableInventory,
    enableFiscal: claims.enableFiscal,
    enableLoyalty: claims.enableLoyalty,
    enableAdvancedReports: claims.enableAdvancedReports,
    enableTables: claims.enableTables,
    enableDelivery: claims.enableDelivery,
    enableWaiters: claims.enableWaiters,
    enableSplitBill: claims.enableSplitBill,
    enableTips: claims.enableTips,
    enableKitchen: claims.enableKitchen,
    enableKitchenDisplay: claims.enableKitchenDisplay,
    enableKitchenTickets: claims.enableKitchenTickets,
    enableKitchenPrinting: claims.enableKitchenPrinting,
    enableOrderRounds: claims.enableOrderRounds,
    enableProductModifiers: claims.enableProductModifiers,
    enableReservations: claims.enableReservations,
    enableWaiterShifts: claims.enableWaiterShifts,
    enableQrMenu: claims.enableQrMenu,
    enableGuestsCount: claims.enableGuestsCount,
    user_id: claims.userId,
    tenant_id: claims.tenantId
  };
}

/**
 * Los únicos endpoints donde se acepta el token por la URL: streams de servidor
 * (`EventSource`), que no pueden mandar cabeceras. Se exige además que sea un GET.
 */
function isSseRequest(request: { method: string; url: string }): boolean {
  if (request.method !== 'GET') return false;
  const path = request.url.split('?')[0] ?? '';
  return path.endsWith('/stream');
}

/**
 * Permisos que se apagan cuando la suscripción está en mora (`PAST_DUE`).
 *
 * La regla es una sola y se aplica aquí, no ruta por ruta: **la caja nunca se apaga**. Un
 * comercio en mora sigue vendiendo, cobrando, abriendo y cerrando turno, mandando a cocina
 * y moviendo mesas; lo que pierde es el backoffice — informes, catálogo, usuarios,
 * sucursales, configuración y auditoría. Apagarle el punto de venta a alguien que debe dos
 * semanas no acelera el pago: le hace perder el día y nos convierte a nosotros en el
 * problema.
 *
 * Nótese lo que **no** está en esta lista: `sales:*`, `cash:*`, `returns:create`,
 * `customers:*`, `products:view`, `inventory:view`, `terminals:view` y `branches:view`. Sin
 * ellos no se puede atender a un cliente.
 */
const DEGRADED_DENIED_PERMISSIONS = new Set<UserPermission>([
  'reports:view',
  'dashboard:view',
  'dashboard:global:view',
  'products:manage',
  'inventory:adjust',
  'inventory:transfer',
  'inventory:receive',
  'inventory:approve_discrepancy',
  'users:manage',
  'branches:manage',
  'terminals:manage',
  'settings:manage',
  'audit:view',
  'alerts:manage',
  'tenant:settings:manage'
]);

/**
 * Aplica el nivel de servicio del comercio antes de comprobar el permiso concreto.
 *
 * Hasta la fase 7, el estado de la suscripción no se miraba en ninguna petición: lo único
 * que bloqueaba era `tenants.status = 'SUSPENDED'`, y solo en el login. Una suscripción
 * cancelada o vencida hacía meses seguía operando con normalidad — no había ninguna barrera
 * técnica entre pagar y no pagar.
 */
async function assertServiceLevelAllows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: any,
  permissions: UserPermission[]
): Promise<void> {
  if (!request.auth?.tenantId) return;

  const entitlements = await app.entitlements.resolve(request.auth.tenantId);

  if (entitlements.serviceLevel === 'BLOCKED') {
    throw new AppError(
      403,
      'SUBSCRIPTION_INACTIVE',
      'La suscripción de este negocio no está activa. Contacta al administrador para reactivarla.'
    );
  }

  if (entitlements.serviceLevel === 'DEGRADED') {
    const blocked = permissions.filter((p) => DEGRADED_DENIED_PERMISSIONS.has(p));
    if (blocked.length > 0) {
      throw new AppError(
        403,
        'SUBSCRIPTION_PAST_DUE',
        'Tu suscripción está pendiente de pago. Puedes seguir vendiendo y cobrando; el resto de la administración se reactiva al ponerte al día.',
        { blocked_permissions: blocked }
      );
    }
  }
}

const authPluginImpl: FastifyPluginAsync = async (app) => {
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: 'access_token',
      signed: false
    }
  });

  app.decorateRequest('auth', null);

  app.decorate('authenticate', async (request) => {
    try {
      // `EventSource` no permite cabeceras propias, así que los streams SSE tienen que
      // mandar el token por la URL. Es una concesión al navegador, no un mecanismo
      // general: un JWT en la query queda en los registros de los proxys, en el historial
      // del navegador y en la cabecera `Referer` hacia terceros.
      //
      // Antes esta puerta estaba abierta en *todas* las rutas, de modo que cualquier
      // petición podía autenticarse con `?token=…` y dejar el token escrito por el camino.
      // Ahora solo se acepta en los endpoints de streaming, y el token se borra de la URL
      // que se registra (ver el serializador de peticiones en `build-app.ts`).
      if (!request.headers.authorization && isSseRequest(request)) {
        const query = request.query as { token?: unknown } | undefined;
        if (query && typeof query.token === 'string') {
          request.headers.authorization = `Bearer ${query.token}`;
        }
      }
      await request.jwtVerify<JwtClaims>();
      request.auth = mapClaimsToAuthContext(request.user);
    } catch {
      throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado: token inválido o ausente');
    }
  });

  app.decorate('requirePermissions', (permissions: UserPermission[]) => {
    return async (request) => {
      await app.authenticate(request);

      if (!request.auth) {
        throw new AppError(403, 'AUTH_FORBIDDEN', 'No tienes permisos para acceder a este recurso');
      }

      // El usuario global o admin siempre puede hacer todo lo de su jerarquía (ADMIN o PLATFORM/TENANT_OWNER).
      if (request.auth.isPlatformRole) {
        return;
      }

      await assertServiceLevelAllows(app, request, permissions);

      if (request.auth.role === 'TENANT_OWNER' || request.auth.role === 'ADMIN') {
        // TENANT_OWNER and ADMIN bypass permissions checks for convenience, EXCEPT for platform permissions
        // We ensure platform permissions are NOT bypassed by TENANT_OWNER/ADMIN
        const hasPlatformPerms = permissions.some(p => p.startsWith('platform:'));
        if (!hasPlatformPerms) {
          return;
        }
      }

      const hasPermission = permissions.every(p => request.auth!.permissions.includes(p));
      if (!hasPermission) {
        throw new AppError(403, 'AUTH_FORBIDDEN', 'No tienes permisos para realizar esta acción');
      }
    };
  });

  app.decorate('requirePlatformOwner', async (request) => {
    await app.authenticate(request);
    if (!request.auth || !request.auth.isPlatformRole) {
      throw new AppError(403, 'AUTH_FORBIDDEN', 'Solo accesible para administradores de plataforma');
    }
  });

  app.decorate('requireTenantOwnerOrAdmin', async (request) => {
    await app.authenticate(request);
    if (!request.auth || (request.auth.role !== 'TENANT_OWNER' && request.auth.role !== 'ADMIN' && !request.auth.isPlatformRole)) {
      throw new AppError(403, 'AUTH_FORBIDDEN', 'Solo accesible para administradores de negocio');
    }
  });

  /**
   * `table_transfer` y `pre_check` no son módulos con estado propio: son alias de `tables`.
   * Antes vivían como dos ramas más del `switch`; ahora se resuelven aquí, que es el único
   * sitio donde el alias tiene sentido.
   */
  const MODULE_ALIASES: Partial<Record<import('@pos-dian/shared').BusinessModule, import('@pos-dian/shared').AssignableModule>> = {
    table_transfer: 'tables',
    pre_check: 'tables'
  };

  app.decorate('requireModule', (modules: import('@pos-dian/shared').BusinessModule[]) => {
    return async (request) => {
      await app.authenticate(request);

      if (!request.auth) {
        throw new AppError(403, 'AUTH_FORBIDDEN', 'No autorizado');
      }

      // Un rol de plataforma no tiene comercio propio; el que suplanta sí lo tiene.
      if (request.auth.isPlatformRole && !request.auth.tenantId) {
        return;
      }

      // Los módulos se resuelven contra la base (con caché en Redis), no contra el token.
      // Mientras viajaban firmados en el JWT, encender un módulo no surtía efecto hasta que
      // el usuario cerraba sesión — y un `switch` de 21 ramas escrito a mano ya se había
      // desincronizado una vez de las columnas que decía representar.
      const entitlements = await app.entitlements.resolve(request.auth.tenantId!);
      const enabled = new Set(entitlements.modules);

      // Basta con uno: `requireModule(['tables', 'kitchen'])` pasa si cualquiera está activo.
      const hasAccess = modules.some((m) => enabled.has(MODULE_ALIASES[m] ?? (m as never)));

      if (!hasAccess) {
        throw new AppError(403, 'MODULE_DISABLED', 'Este módulo no está habilitado para tu suscripción');
      }
    };
  });
};

export const authPlugin = fp(authPluginImpl, {
  name: 'auth-plugin'
});
