import { randomBytes, createHash, randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { loginBodySchema } from '@pos-dian/shared';
import { z } from 'zod';
import { env } from '../../../app/env.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import {
  assertLoginRateLimitAllowed,
  buildLoginRateLimitKey,
  clearLoginRateLimit,
  recordLoginRateLimitFailure
} from '../../../shared/infra/security/login-rate-limit.js';
import { getPermissionsForRole } from '../../../shared/infra/security/permissions.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';

const registerBodySchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8),
  name: z.string().min(1),
  tenant_name: z.string().min(1),
  tenant_business_name: z.string().min(1),
  tenant_document_type: z.enum(['NIT', 'CC', 'CE', 'PASSPORT']),
  tenant_document_number: z.string().min(1),
  tax_mode: z.enum(['IVA', 'INC_RESTAURANT']).default('IVA'),
  plan: z.string().default('STARTER'),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/auth/register',
    {
      schema: {
        tags: ['auth'],
        body: registerBodySchema
      }
    },
    async (request, reply) => {
      const payload = registerBodySchema.parse(request.body);

      const existingUser = await app.db.selectFrom('users').where('email', '=', payload.email).select('id').executeTakeFirst();
      if (existingUser) {
        throw new AppError(400, 'BAD_REQUEST', 'El correo electrónico ya está registrado');
      }

      const existingTenant = await app.db.selectFrom('tenants').where('nit', '=', payload.tenant_document_number).select('id').executeTakeFirst();
      if (existingTenant) {
        throw new AppError(400, 'BAD_REQUEST', 'El documento del negocio ya está registrado');
      }

      const passwordHash = await hashPassword(payload.password);
      const tenantId = randomUUID();
      const userId = randomUUID();

      await app.db.transaction().execute(async (trx) => {
        await trx.insertInto('tenants').values({
          id: tenantId,
          name: payload.tenant_name,
          business_name: payload.tenant_business_name,
          nit: payload.tenant_document_number,
          address: 'No especificada',
          tax_mode: payload.tax_mode,
          status: 'TRIAL',
          plan: payload.plan,
          owner_user_id: userId
        }).execute();

        await trx.insertInto('users').values({
          id: userId,
          tenant_id: tenantId,
          email: payload.email,
          password_hash: passwordHash,
          name: payload.name,
          role: 'TENANT_OWNER',
          active: true
        }).execute();

        const branchId = randomUUID();
        await trx.insertInto('branches').values({
          id: branchId,
          tenant_id: tenantId,
          name: 'Sucursal Principal',
          address: 'No especificada'
        }).execute();

        await trx.insertInto('user_branches').values({
          tenant_id: tenantId,
          user_id: userId,
          branch_id: branchId
        }).execute();
      });

      await writeAuditLog(app.db, {
        tenantId: tenantId,
        userId: userId,
        entityType: 'TENANT',
        entityId: tenantId,
        action: 'TENANT_CREATED',
        payloadJson: { current: { plan: payload.plan, status: 'TRIAL', tax_mode: payload.tax_mode } }
      });

      // Simular envío de notificación (email) al administrador inicial
      app.log.info({
        event: 'EMAIL_SENT',
        to: payload.email,
        subject: 'Bienvenido al POS',
        body: `Hola ${payload.name}, tu negocio ${payload.tenant_business_name} ha sido registrado exitosamente con el plan ${payload.plan}.`
      });

      return reply.code(201).send({ success: true, message: 'Registro exitoso' });
    }
  );

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
      const rateLimitKey = buildLoginRateLimitKey(request.ip, email, tenantId);

      try {
        await assertLoginRateLimitAllowed(app.redis, rateLimitKey);
      } catch {
        throw new AppError(429, 'AUTH_RATE_LIMITED', 'Demasiados intentos de inicio de sesión. Intenta de nuevo más tarde.');
      }

      let candidatesQuery = app.db
        .selectFrom('users')
        .leftJoin('tenants', 'tenants.id', 'users.tenant_id')
        .select([
          'users.id as id',
          'users.tenant_id as tenant_id',
          'tenants.name as tenant_name',
          'tenants.business_name as tenant_business_name',
          'tenants.tax_mode as tax_mode',
          'tenants.status as tenant_status',
          'tenants.plan as tenant_plan',
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

      let validCandidates = [];
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
        const platformOwner = validCandidates.find(c => c.role === 'PLATFORM_OWNER');
        if (platformOwner) {
          // If there's a platform owner account, default to it (ignoring duplicates or tenant accounts)
          validCandidates = [platformOwner];
        } else {
          // Filter out any candidates without a tenant (safety check)
          const tenantCandidates = validCandidates.filter(c => c.tenant_id);
          if (tenantCandidates.length > 1) {
            return {
              requireTenantSelection: true,
              tenants: tenantCandidates.map(c => ({
                id: c.tenant_id!,
                name: c.tenant_name!,
                business_name: c.tenant_business_name!
              }))
            };
          } else {
            validCandidates = [tenantCandidates[0]!];
          }
        }
      }

      const user = validCandidates[0]!;

      if (user.tenant_status === 'SUSPENDED') {
        throw new AppError(403, 'AUTH_FORBIDDEN', 'El negocio se encuentra suspendido. Contacta al administrador de la plataforma.');
      }

      let branchIds: string[] = [];
      if (user.tenant_id) {
          const userBranches = await app.db
            .selectFrom('user_branches')
            .select('branch_id')
            .where('user_id', '=', user.id)
            .where('tenant_id', '=', user.tenant_id)
            .execute();
          branchIds = userBranches.map(b => b.branch_id);
      }

      const isPlatformRole = user.role === 'PLATFORM_OWNER';
      const permissions = getPermissionsForRole(user.role);

      const claims = {
        sub: user.id,
        userId: user.id,
        tenantId: user.tenant_id,
        tenantPlan: user.tenant_plan,
        role: user.role,
        email: user.email,
        name: user.name,
        branchIds,
        permissions,
        isPlatformRole
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
        tenant_id: user.tenant_id,
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
          tenantPlan: user.tenant_plan,
          taxMode: user.tax_mode,
          role: user.role,
          email: user.email,
          name: user.name,
          active: user.active,
          branchIds,
          permissions,
          isPlatformRole
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

      let query = app.db
        .selectFrom('users')
        .leftJoin('tenants', 'tenants.id', 'users.tenant_id')
        .select([
          'users.id as id',
          'users.tenant_id as tenant_id',
          'tenants.tax_mode as tax_mode',
          'tenants.status as tenant_status',
          'tenants.plan as tenant_plan',
          'users.email as email',
          'users.name as name',
          'users.role as role',
          'users.active as active'
        ])
        .where('users.id', '=', request.auth.userId)
        .where('users.active', '=', true);

      if (!request.auth.isPlatformRole) {
        query = query.where('users.tenant_id', '=', request.auth.tenantId!);
      }

      const user = await query.executeTakeFirst();

      if (!user) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'Usuario no encontrado o inactivo');
      }

      if (user.tenant_status === 'SUSPENDED') {
        throw new AppError(403, 'AUTH_FORBIDDEN', 'El negocio se encuentra suspendido. Contacta al administrador de la plataforma.');
      }

      let branchIds: string[] = [];
      if (user.tenant_id) {
          const userBranches = await app.db
            .selectFrom('user_branches')
            .select('branch_id')
            .where('user_id', '=', user.id)
            .where('tenant_id', '=', user.tenant_id)
            .execute();
          branchIds = userBranches.map(b => b.branch_id);
      }

      const permissions = getPermissionsForRole(user.role);
      const isPlatformRole = user.role === 'PLATFORM_OWNER';

      return {
        user: {
          id: user.id,
          tenantId: user.tenant_id,
          tenantPlan: user.tenant_plan,
          taxMode: user.tax_mode,
          role: user.role,
          email: user.email,
          name: user.name,
          active: user.active,
          branchIds,
          permissions,
          isPlatformRole
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
    '/auth/impersonate/exchange',
    {
      schema: {
        tags: ['auth'],
        body: z.object({ session_id: z.string() })
      }
    },
    async (request, reply) => {
      const { session_id } = request.body;

      const session = await app.db.selectFrom('impersonation_sessions')
        .where('id', '=', session_id)
        .where('expires_at', '>', new Date())
        .selectAll()
        .executeTakeFirst();

      if (!session) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'Sesión de suplantación inválida o expirada');
      }

      const user = await app.db
        .selectFrom('users')
        .leftJoin('tenants', 'tenants.id', 'users.tenant_id')
        .select([
          'users.id as id',
          'users.tenant_id as tenant_id',
          'tenants.tax_mode as tax_mode',
          'tenants.status as tenant_status',
          'tenants.plan as tenant_plan',
          'users.email as email',
          'users.name as name',
          'users.role as role',
          'users.active as active'
        ])
        .where('users.id', '=', session.target_user_id)
        .where('users.active', '=', true)
        .executeTakeFirst();

      if (!user) {
        throw new AppError(403, 'AUTH_FORBIDDEN', 'El usuario objetivo no está disponible');
      }

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
        tenant_id: user.tenant_id,
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

      let branchIds: string[] = [];
      if (user.tenant_id) {
          const userBranches = await app.db
            .selectFrom('user_branches')
            .select('branch_id')
            .where('user_id', '=', user.id)
            .where('tenant_id', '=', user.tenant_id)
            .execute();
          branchIds = userBranches.map(b => b.branch_id);
      }

      const permissions = getPermissionsForRole(user.role);
      const isPlatformRole = user.role === 'PLATFORM_OWNER';

      const claims = {
        sub: user.id,
        userId: user.id,
        tenantId: user.tenant_id,
        tenantPlan: user.tenant_plan,
        role: user.role,
        email: user.email,
        name: user.name,
        branchIds,
        permissions,
        isPlatformRole,
        isImpersonating: true
      };

      const accessToken = await app.jwt.sign(claims, { expiresIn: env.JWT_EXPIRES_IN });

      // Invalidate the impersonation session so it can't be used again
      await app.db.updateTable('impersonation_sessions')
        .set({ expires_at: new Date() })
        .where('id', '=', session_id)
        .execute();

      return {
        accessToken,
        tokenType: 'Bearer' as const,
        expiresIn: env.JWT_EXPIRES_IN,
        user: {
          id: user.id,
          tenantId: user.tenant_id,
          tenantPlan: user.tenant_plan,
          taxMode: user.tax_mode,
          role: user.role,
          email: user.email,
          name: user.name,
          active: user.active,
          branchIds,
          permissions,
          isPlatformRole
        }
      };
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
        .select(['id', 'tenant_id', 'user_id', 'expires_at', 'revoked_at'])
        .where('token_hash', '=', currentHash)
        .executeTakeFirst();

      if (!tokenRecord) {
        reply.clearCookie('pos_refresh_token', { path: '/' });
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'Invalid refresh token');
      }

      if (tokenRecord.revoked_at !== null) {
        let q = app.db
          .updateTable('refresh_tokens')
          .set({ revoked_at: new Date() })
          .where('user_id', '=', tokenRecord.user_id)
          .where('revoked_at', 'is', null);

        if (tokenRecord.tenant_id) {
            q = q.where('tenant_id', '=', tokenRecord.tenant_id);
        }

        await q.execute();

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
        .leftJoin('tenants', 'tenants.id', 'users.tenant_id')
        .select([
          'users.id as id',
          'users.tenant_id as tenant_id',
          'tenants.tax_mode as tax_mode',
          'tenants.status as tenant_status',
          'tenants.plan as tenant_plan',
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

      if (user.tenant_status === 'SUSPENDED') {
        reply.clearCookie('pos_refresh_token', { path: '/' });
        throw new AppError(403, 'AUTH_FORBIDDEN', 'El negocio se encuentra suspendido. Contacta al administrador de la plataforma.');
      }

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

      await app.db.transaction().execute(async (trx) => {
        let updateQ = trx
          .updateTable('refresh_tokens')
          .set({ revoked_at: new Date() })
          .where('id', '=', tokenRecord.id);
        
        if (tokenRecord.tenant_id) {
            updateQ = updateQ.where('tenant_id', '=', tokenRecord.tenant_id);
        }
        await updateQ.execute();

        await trx.insertInto('refresh_tokens').values({
          id: randomUUID(),
          tenant_id: user.tenant_id,
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

      let branchIds: string[] = [];
      if (user.tenant_id) {
          const userBranches = await app.db
            .selectFrom('user_branches')
            .select('branch_id')
            .where('user_id', '=', user.id)
            .where('tenant_id', '=', user.tenant_id)
            .execute();
          branchIds = userBranches.map(b => b.branch_id);
      }

      const permissions = getPermissionsForRole(user.role);
      const isPlatformRole = user.role === 'PLATFORM_OWNER';

      const claims = {
        sub: user.id,
        userId: user.id,
        tenantId: user.tenant_id,
        tenantPlan: user.tenant_plan,
        role: user.role,
        email: user.email,
        name: user.name,
        branchIds,
        permissions,
        isPlatformRole
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
          tenantPlan: user.tenant_plan,
          taxMode: user.tax_mode,
          role: user.role,
          email: user.email,
          name: user.name,
          active: user.active,
          branchIds,
          permissions,
          isPlatformRole
        }
      };
    }
  );
};
