import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { loginBodySchema } from '@pos-dian/shared';
import { env } from '../app/env.js';
import { verifyPassword } from '../auth/password.js';
import { AppError } from '../infra/errors/app-error.js';
import {
  assertLoginRateLimitAllowed,
  buildLoginRateLimitKey,
  clearLoginRateLimit,
  recordLoginRateLimitFailure
} from '../infra/security/login-rate-limit.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/auth/login',
    {
      schema: {
        tags: ['auth'],
        body: loginBodySchema
      }
    },
    async (request) => {
      const { email, password } = loginBodySchema.parse(request.body);
      const rateLimitKey = buildLoginRateLimitKey(request.ip, email);

      try {
        assertLoginRateLimitAllowed(rateLimitKey);
      } catch {
        throw new AppError(
          429,
          'AUTH_RATE_LIMITED',
          'Demasiados intentos de inicio de sesión. Intenta de nuevo más tarde.'
        );
      }

      const candidates = await app.db
        .selectFrom('users')
        .innerJoin('tenants', 'tenants.id', 'users.tenant_id')
        .select([
          'users.id as id',
          'users.tenant_id as tenant_id',
          'tenants.tax_mode as tax_mode',
          'users.email as email',
          'users.password_hash as password_hash',
          'users.name as name',
          'users.role as role',
          'users.active as active'
        ])
        .where('users.email', '=', email)
        .where('users.active', '=', true)
        .execute();

      if (candidates.length === 0) {
        recordLoginRateLimitFailure(rateLimitKey);
        throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Credenciales inválidas');
      }

      if (candidates.length > 1) {
        recordLoginRateLimitFailure(rateLimitKey);
        throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Credenciales inválidas');
      }

      const [user] = candidates;
      if (!user) {
        throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Credenciales inválidas');
      }

      const isValidPassword = await verifyPassword(password, user.password_hash);

      if (!isValidPassword) {
        recordLoginRateLimitFailure(rateLimitKey);
        throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Credenciales inválidas');
      }

      clearLoginRateLimit(rateLimitKey);

      const claims = {
        sub: user.id,
        userId: user.id,
        tenantId: user.tenant_id,
        role: user.role,
        email: user.email,
        name: user.name
      };

      const accessToken = await app.jwt.sign(claims, {
        expiresIn: env.JWT_EXPIRES_IN
      });

      return {
        accessToken,
        tokenType: 'Bearer' as const,
        expiresIn: env.JWT_EXPIRES_IN,
        user: {
          id: user.id,
          tenantId: user.tenant_id,
          taxMode: user.tax_mode,
          role: user.role,
          email: user.email,
          name: user.name,
          active: user.active
        }
      };
    }
  );

  typedApp.get(
    '/auth/me',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const user = await app.db
        .selectFrom('users')
        .innerJoin('tenants', 'tenants.id', 'users.tenant_id')
        .select([
          'users.id as id',
          'users.tenant_id as tenant_id',
          'tenants.tax_mode as tax_mode',
          'users.email as email',
          'users.name as name',
          'users.role as role',
          'users.active as active'
        ])
        .where('users.tenant_id', '=', request.auth.tenantId)
        .where('users.id', '=', request.auth.userId)
        .where('users.active', '=', true)
        .executeTakeFirst();

      if (!user) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'Usuario no encontrado o inactivo');
      }

      return {
        user: {
          id: user.id,
          tenantId: user.tenant_id,
          taxMode: user.tax_mode,
          role: user.role,
          email: user.email,
          name: user.name,
          active: user.active
        }
      };
    }
  );
};
