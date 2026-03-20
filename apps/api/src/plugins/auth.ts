import jwt from '@fastify/jwt';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { AuthContext, JwtClaims, UserRole } from '../auth/types.js';
import { env } from '../app/env.js';
import { AppError } from '../infra/errors/app-error.js';

function mapClaimsToAuthContext(claims: JwtClaims): AuthContext {
  return {
    userId: claims.userId,
    tenantId: claims.tenantId,
    role: claims.role,
    email: claims.email,
    name: claims.name,
    user_id: claims.userId,
    tenant_id: claims.tenantId
  };
}

const authPluginImpl: FastifyPluginAsync = async (app) => {
  await app.register(jwt, {
    secret: env.JWT_SECRET
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

  app.decorate('requireRoles', (roles: UserRole[]) => {
    return async (request) => {
      await app.authenticate(request);

      if (!request.auth || !roles.includes(request.auth.role)) {
        throw new AppError(403, 'AUTH_FORBIDDEN', 'No tienes permisos para acceder a este recurso');
      }
    };
  });
};

export const authPlugin = fp(authPluginImpl, {
  name: 'auth-plugin'
});
