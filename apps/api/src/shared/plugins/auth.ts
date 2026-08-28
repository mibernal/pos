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

  app.decorate('requireModule', (modules: import('@pos-dian/shared').BusinessModule[]) => {
    return async (request) => {
      await app.authenticate(request);

      if (!request.auth) {
        throw new AppError(403, 'AUTH_FORBIDDEN', 'No autorizado');
      }

      // Check if at least one of the required modules is enabled.
      // E.g., if requireModule(['tables', 'kitchen']) is called, it passes if AT LEAST ONE is active.
      const hasAccess = modules.some(m => {
        switch (m) {
          case 'restaurant': return request.auth!.enableRestaurant;
          case 'kds': return request.auth!.enableKds;
          case 'inventory': return request.auth!.enableInventory;
          case 'fiscal': return request.auth!.enableFiscal;
          case 'loyalty': return request.auth!.enableLoyalty;
          case 'advanced_reports': return request.auth!.enableAdvancedReports;
          case 'tables': return request.auth!.enableTables;
          case 'delivery': return request.auth!.enableDelivery;
          case 'waiters': return request.auth!.enableWaiters;
          case 'split_bill': return request.auth!.enableSplitBill;
          case 'tips': return request.auth!.enableTips;
          case 'kitchen': return request.auth!.enableKitchen;
          case 'kitchen_display': return request.auth!.enableKitchenDisplay;
          case 'kitchen_tickets': return request.auth!.enableKitchenTickets;
          case 'kitchen_printing': return request.auth!.enableKitchenPrinting;
          case 'order_rounds': return request.auth!.enableOrderRounds;
          case 'product_modifiers': return request.auth!.enableProductModifiers;
          case 'reservations': return request.auth!.enableReservations;
          case 'waiter_shifts': return request.auth!.enableWaiterShifts;
          case 'qr_menu': return request.auth!.enableQrMenu;
          case 'guests_count': return request.auth!.enableGuestsCount;
          // Legacy support or alias logic just in case:
          case 'table_transfer': return request.auth!.enableTables;
          case 'pre_check': return request.auth!.enableTables;
          default: return false;
        }
      });

      if (!hasAccess) {
        throw new AppError(403, 'MODULE_DISABLED', 'Este módulo no está habilitado para tu suscripción');
      }
    };
  });
};

export const authPlugin = fp(authPluginImpl, {
  name: 'auth-plugin'
});
