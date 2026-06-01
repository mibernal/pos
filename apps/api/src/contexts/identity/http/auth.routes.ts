import { randomBytes, createHash, randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { loginBodySchema } from '@pos-dian/shared';
import { env } from '../../../app/env.js';
import { verifyPassword } from '../auth/password.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import {
  assertLoginRateLimitAllowed,
  buildLoginRateLimitKey,
  clearLoginRateLimit,
  recordLoginRateLimitFailure
} from '../../../shared/infra/security/login-rate-limit.js';
import { getPermissionsForRole } from '../../../shared/infra/security/permissions.js';

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

      const userBranches = await app.db
        .selectFrom('user_branches')
        .select('branch_id')
        .where('user_id', '=', user.id)
        .where('tenant_id', '=', user.tenant_id)
        .execute();

      const branchIds = userBranches.map(b => b.branch_id);
      const permissions = getPermissionsForRole(user.role);

      const claims = {
        sub: user.id,
        userId: user.id,
        tenantId: user.tenant_id,
        role: user.role,
        email: user.email,
        name: user.name,
        branchIds,
        permissions
      };

      const accessToken = await app.jwt.sign(claims, {
        expiresIn: env.JWT_EXPIRES_IN
      });

      const refreshTokenRaw = randomBytes(32).toString('hex');
      const refreshTokenHash = createHash('sha256').update(refreshTokenRaw).digest('hex');
      
      const match = env.REFRESH_TOKEN_EXPIRES_IN.match(/^(\d+)([dhms])$/);
      let expMs = 7 * 24 * 60 * 60 * 1000;
      if (match) {
        const val = parseInt(match[1]!, 10);
        if (match[2] === 'd') expMs = val * 24 * 60 * 60 * 1000;
        if (match[2] === 'h') expMs = val * 60 * 60 * 1000;
        if (match[2] === 'm') expMs = val * 60 * 1000;
      }
      const expiresAt = new Date(Date.now() + expMs);

      await app.db.insertInto('refresh_tokens').values({
        id: randomUUID(),
        user_id: user.id,
        token_hash: refreshTokenHash,
        expires_at: expiresAt,
        created_at: new Date(),
        revoked_at: null
      }).execute();

      reply.setCookie('pos_refresh_token', refreshTokenRaw, {
        path: '/',
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: expMs / 1000
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
          active: user.active,
          branchIds,
          permissions
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

      const userBranches = await app.db
        .selectFrom('user_branches')
        .select('branch_id')
        .where('user_id', '=', user.id)
        .where('tenant_id', '=', user.tenant_id)
        .execute();

      const branchIds = userBranches.map(b => b.branch_id);
      const permissions = getPermissionsForRole(user.role);

      return {
        user: {
          id: user.id,
          tenantId: user.tenant_id,
          taxMode: user.tax_mode,
          role: user.role,
          email: user.email,
          name: user.name,
          active: user.active,
          branchIds,
          permissions
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
      const currentToken = request.cookies['pos_refresh_token'];
      if (currentToken) {
        const currentHash = createHash('sha256').update(currentToken).digest('hex');
        await app.db.updateTable('refresh_tokens')
          .set({ revoked_at: new Date() })
          .where('token_hash', '=', currentHash)
          .execute();
      }
      
      reply.clearCookie('pos_refresh_token', {
        path: '/'
      });
      return { success: true };
    }
  );

  typedApp.post(
    '/auth/refresh',
    {
      schema: {
        tags: ['auth']
      }
    },
    async (request, reply) => {
      const currentToken = request.cookies['pos_refresh_token'];
      if (!currentToken) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No refresh token provided');
      }

      const currentHash = createHash('sha256').update(currentToken).digest('hex');

      const tokenRecord = await app.db
        .selectFrom('refresh_tokens')
        .select(['id', 'user_id', 'expires_at', 'revoked_at'])
        .where('token_hash', '=', currentHash)
        .executeTakeFirst();

      if (!tokenRecord) {
        reply.clearCookie('pos_refresh_token', { path: '/' });
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'Invalid refresh token');
      }

      // SEC: Reuse Detection — RFC 6749 / Auth0 Token Family Strategy.
      // Si el token ya fue revocado, alguien lo está reutilizando (posible robo).
      // Revocamos TODA la familia activa del usuario y forzamos re-login.
      if (tokenRecord.revoked_at !== null) {
        await app.db
          .updateTable('refresh_tokens')
          .set({ revoked_at: new Date() })
          .where('user_id', '=', tokenRecord.user_id)
          .where('revoked_at', 'is', null)
          .execute();

        reply.clearCookie('pos_refresh_token', { path: '/' });
        throw new AppError(
          401,
          'AUTH_TOKEN_REUSE_DETECTED',
          'Sesión invalidada por uso sospechoso del token. Vuelve a iniciar sesión.'
        );
      }

      if (tokenRecord.expires_at < new Date()) {
        reply.clearCookie('pos_refresh_token', { path: '/' });
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'Refresh token expired');
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
        .where('users.id', '=', tokenRecord.user_id)
        .where('users.active', '=', true)
        .executeTakeFirst();

      if (!user) {
        reply.clearCookie('pos_refresh_token', { path: '/' });
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'User not found or inactive');
      }

      // Preparar el nuevo token antes de la transacción
      const refreshTokenRaw = randomBytes(32).toString('hex');
      const refreshTokenHash = createHash('sha256').update(refreshTokenRaw).digest('hex');

      const match = env.REFRESH_TOKEN_EXPIRES_IN.match(/^(\d+)([dhms])$/);
      let expMs = 7 * 24 * 60 * 60 * 1000;
      if (match) {
        const val = parseInt(match[1]!, 10);
        if (match[2] === 'd') expMs = val * 24 * 60 * 60 * 1000;
        if (match[2] === 'h') expMs = val * 60 * 60 * 1000;
        if (match[2] === 'm') expMs = val * 60 * 1000;
      }
      const expiresAt = new Date(Date.now() + expMs);

      // Revoke old + Insert new en una transacción atómica
      // Evita el estado parcial donde el token viejo ya fue revocado pero el nuevo no existe aún
      await app.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('refresh_tokens')
          .set({ revoked_at: new Date() })
          .where('id', '=', tokenRecord.id)
          .execute();

        await trx.insertInto('refresh_tokens').values({
          id: randomUUID(),
          user_id: user.id,
          token_hash: refreshTokenHash,
          expires_at: expiresAt,
          created_at: new Date(),
          revoked_at: null
        }).execute();
      });

      reply.setCookie('pos_refresh_token', refreshTokenRaw, {
        path: '/',
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: expMs / 1000
      });

      const userBranches = await app.db
        .selectFrom('user_branches')
        .select('branch_id')
        .where('user_id', '=', user.id)
        .where('tenant_id', '=', user.tenant_id)
        .execute();

      const branchIds = userBranches.map(b => b.branch_id);
      const permissions = getPermissionsForRole(user.role);

      const claims = {
        sub: user.id,
        userId: user.id,
        tenantId: user.tenant_id,
        role: user.role,
        email: user.email,
        name: user.name,
        branchIds,
        permissions
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
          active: user.active,
          branchIds,
          permissions
        }
      };
    }
  );
};
