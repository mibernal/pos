import jwt from '@fastify/jwt';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { AuthContext, JwtClaims, UserRole, UserPermission } from '../infra/security/types.js';
import { env } from '../../app/env.js';
import { AppError } from '../infra/errors/app-error.js';

function mapClaimsToAuthContext(claims: JwtClaims): AuthContext {
  return {
    userId: claims.userId,
    tenantId: claims.tenantId,
    role: claims.role,
    email: claims.email,
    name: claims.name,
    branchIds: claims.branchIds,
    permissions: claims.permissions,
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

      // El usuario global ADMIN siempre puede hacer todo. Si su rol es ADMIN, omitimos chequear.
      if (request.auth.role === 'ADMIN') {
        return;
      }

      const hasPermission = permissions.every(p => request.auth!.permissions.includes(p));
      if (!hasPermission) {
        throw new AppError(403, 'AUTH_FORBIDDEN', 'No tienes permisos para realizar esta acción');
      }
    };
  });
};

export const authPlugin = fp(authPluginImpl, {
  name: 'auth-plugin'
});
