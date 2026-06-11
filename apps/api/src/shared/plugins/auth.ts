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
    user_id: claims.userId,
    tenant_id: claims.tenantId
  };
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
      // Allow token from query param for EventSource (SSE)
      if (!request.headers.authorization && request.query && typeof request.query === 'object' && 'token' in request.query) {
        request.headers.authorization = `Bearer ${(request.query as any).token}`; // eslint-disable-line @typescript-eslint/no-explicit-any
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
};

export const authPlugin = fp(authPluginImpl, {
  name: 'auth-plugin'
});
