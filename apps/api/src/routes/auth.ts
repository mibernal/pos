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
    async (request, reply) => {
      const { email, password, tenantId } = loginBodySchema.parse(request.body);
      const rateLimitKey = buildLoginRateLimitKey(request.ip, email);

      // C2: Rate limit persistido en Redis — sobrevive restarts y escala horizontal
      try {
        await assertLoginRateLimitAllowed(app.redis, rateLimitKey);
      } catch {
        throw new AppError(
          429,
          'AUTH_RATE_LIMITED',
          'Demasiados intentos de inicio de sesión. Intenta de nuevo más tarde.'
        );
      }

      let candidatesQuery = app.db
        .selectFrom('users')
        .innerJoin('tenants', 'tenants.id', 'users.tenant_id')
        .select([
          'users.id as id',
          'users.tenant_id as tenant_id',
          'tenants.name as tenant_name',
          'tenants.business_name as tenant_business_name',
          'tenants.tax_mode as tax_mode',
          'users.email as email',
          'users.password_hash as password_hash',
          'users.name as name',
          'users.role as role',
          'users.active as active'
        ])
        .where('users.email', '=', email)
        .where('users.active', '=', true);

      if (tenantId) {
        candidatesQuery = candidatesQuery.where('users.tenant_id', '=', tenantId);
      }

      const candidates = await candidatesQuery.execute();

      if (candidates.length === 0) {
        await recordLoginRateLimitFailure(app.redis, rateLimitKey);
        throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Credenciales inválidas');
      }

      const validCandidates = [];
      for (const candidate of candidates) {
        const isValidPassword = await verifyPassword(password, candidate.password_hash);
        if (isValidPassword) {
          validCandidates.push(candidate);
        }
      }

      if (validCandidates.length === 0) {
        await recordLoginRateLimitFailure(app.redis, rateLimitKey);
        throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Credenciales inválidas');
      }

      await clearLoginRateLimit(app.redis, rateLimitKey);

      if (validCandidates.length > 1) {
        return {
          requireTenantSelection: true,
          tenants: validCandidates.map(c => ({
            id: c.tenant_id,
            name: c.tenant_name,
            business_name: c.tenant_business_name
          }))
        };
      }

      const user = validCandidates[0]!;

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

      // @ts-expect-error fastify-cookie types are not installed yet
      reply.setCookie('access_token', accessToken, {
        path: '/',
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 // 7 days (or match token expiry)
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

  typedApp.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth']
      }
    },
    async (request, reply) => {
      // @ts-expect-error fastify-cookie types are not installed yet
      reply.clearCookie('access_token', {
        path: '/'
      });
      return { success: true };
    }
  );
};
