import { createHash, randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { loginBodySchema } from '@pos-dian/shared';
import { z } from 'zod';
import { env } from '../../../app/env.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import {
  assertAndRecordLoginAttempt,
  clearLoginRateLimit,
  buildLoginRateLimitKey,
  assertAndRecordIpRateLimit,
  assertAndRecordIpRateLimitSync,
  buildIpRateLimitKey
} from '../../../shared/infra/security/login-rate-limit.js';
import { getPermissionsForRole } from '../../../shared/infra/security/permissions.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';
import { SubscriptionService } from '../../billing/application/subscription.service.js';
import {
  getUserBranchIds,
  generateRefreshToken,
  setRefreshTokenCookie,
  buildAuthResponse,
  getUserForAuth,
  buildUserDto
} from './auth.utils.js';
import { NotificationService } from '../../../shared/infra/notifications/NotificationService.js';

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
  business_type: z.enum(['RESTAURANT','CAFETERIA','BAKERY','FAST_FOOD','BAR','NIGHTCLUB','BUTCHER','MINIMARKET','SUPERMARKET','CORNER_STORE','HARDWARE_STORE','PHARMACY','STATIONERY','BOUTIQUE','OTHER']),
  custom_business_type: z.string().trim().min(2).max(80).nullable().optional(),
  enable_tables: z.boolean().optional(),
  enable_delivery: z.boolean().optional(),
  enable_waiters: z.boolean().optional(),
  enable_split_bill: z.boolean().optional(),
  enable_tips: z.boolean().optional(),
  enable_kitchen: z.boolean().optional(),
  enable_kitchen_display: z.boolean().optional(),
  enable_kitchen_tickets: z.boolean().optional(),
  enable_kitchen_printing: z.boolean().optional(),
  enable_order_rounds: z.boolean().optional(),
  enable_product_modifiers: z.boolean().optional(),
  enable_reservations: z.boolean().optional(),
  enable_waiter_shifts: z.boolean().optional(),
  enable_qr_menu: z.boolean().optional(),
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
          business_type: payload.business_type,
          custom_business_type: payload.business_type === 'OTHER' ? (payload.custom_business_type ?? null) : null,
          enable_tables: payload.business_type === 'OTHER' ? (payload.enable_tables ?? false) : ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type),
          enable_delivery: payload.business_type === 'OTHER' ? (payload.enable_delivery ?? false) : ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type),
          enable_waiters: payload.business_type === 'OTHER' ? (payload.enable_waiters ?? false) : ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type),
          enable_split_bill: payload.business_type === 'OTHER' ? (payload.enable_split_bill ?? false) : ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type),
          enable_tips: payload.business_type === 'OTHER' ? (payload.enable_tips ?? false) : ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type),
          enable_kitchen: payload.business_type === 'OTHER' ? (payload.enable_kitchen ?? false) : ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type),
          enable_kitchen_display: payload.business_type === 'OTHER' ? (payload.enable_kitchen_display ?? false) : false,
          enable_kitchen_tickets: payload.business_type === 'OTHER' ? (payload.enable_kitchen_tickets ?? false) : ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type),
          enable_kitchen_printing: payload.business_type === 'OTHER' ? (payload.enable_kitchen_printing ?? false) : false,
          enable_order_rounds: payload.business_type === 'OTHER' ? (payload.enable_order_rounds ?? false) : false,
          enable_product_modifiers: payload.business_type === 'OTHER' ? (payload.enable_product_modifiers ?? false) : false,
          enable_reservations: payload.business_type === 'OTHER' ? (payload.enable_reservations ?? false) : false,
          enable_waiter_shifts: payload.business_type === 'OTHER' ? (payload.enable_waiter_shifts ?? false) : false,
          enable_qr_menu: payload.business_type === 'OTHER' ? (payload.enable_qr_menu ?? false) : false,
          status: 'TRIAL',
          owner_user_id: userId
        }).execute();

        await SubscriptionService.createSubscription(trx, tenantId, payload.plan, 'TRIAL', 14);

        await trx.insertInto('users').values({
          id: userId,
          tenant_id: tenantId!,
          email: payload.email,
          password_hash: passwordHash,
          name: payload.name,
          role: 'TENANT_OWNER',
          active: true
        }).execute();

        const branchId = randomUUID();
        await trx.insertInto('branches').values({
          id: branchId,
          tenant_id: tenantId!,
          name: 'Sucursal Principal',
          address: 'No especificada'
        }).execute();

        await trx.insertInto('user_branches').values({
          tenant_id: tenantId!,
          user_id: userId,
          branch_id: branchId!}).execute();
      });

      await writeAuditLog(app.db, {
        tenantId: tenantId,
        userId: userId,
        entityType: 'TENANT',
        entityId: tenantId,
        action: 'TENANT_CREATED',
        payloadJson: { current: { plan: payload.plan, status: 'TRIAL', tax_mode: payload.tax_mode } }
      });

      // Enviar notificación (email) al administrador inicial
      const notificationService = new NotificationService(app.db);
      await notificationService.notifyTenantWelcome(tenantId, payload.email, {
        tenantName: payload.tenant_business_name,
        ownerName: payload.name,
        planName: payload.plan
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
        await assertAndRecordLoginAttempt(app.redis, rateLimitKey);
      } catch {
        throw new AppError(429, 'AUTH_RATE_LIMITED', 'Demasiados intentos de inicio de sesión. Intenta de nuevo más tarde.');
      }

      let candidatesQuery = app.db
        .selectFrom('users')
        .leftJoin('tenants', 'tenants.id', 'users.tenant_id')
        .leftJoin('tenant_subscriptions as ts', 'ts.tenant_id', 'tenants.id')
        .select([
          'users.id as id',
          'users.tenant_id as tenant_id',
          'tenants.name as tenant_name',
          'tenants.business_name as tenant_business_name',
          'tenants.tax_mode as tax_mode',
          'tenants.business_type as business_type',
          'tenants.enable_tables as enable_tables',
          'tenants.enable_delivery as enable_delivery',
          'tenants.enable_waiters as enable_waiters',
          'tenants.enable_split_bill as enable_split_bill',
          'tenants.enable_tips as enable_tips',
          'tenants.enable_kitchen as enable_kitchen',
          'tenants.enable_kitchen_display as enable_kitchen_display',
          'tenants.enable_kitchen_tickets as enable_kitchen_tickets',
          'tenants.enable_kitchen_printing as enable_kitchen_printing',
          'tenants.enable_order_rounds as enable_order_rounds',
          'tenants.enable_product_modifiers as enable_product_modifiers',
          'tenants.enable_reservations as enable_reservations',
          'tenants.enable_waiter_shifts as enable_waiter_shifts',
          'tenants.enable_qr_menu as enable_qr_menu',
          'tenants.enable_guests_count as enable_guests_count',
          'tenants.status as tenant_status',
          'ts.plan_id as tenant_plan',
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
        throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Credenciales inválidas');
      }

      await clearLoginRateLimit(app.redis, rateLimitKey);

      if (validCandidates.length > 1) {
        const platformOwner = validCandidates.find(c => c.role === 'PLATFORM_OWNER');
        if (platformOwner) {
          validCandidates = [platformOwner];
        } else {
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

      const branchIds = await getUserBranchIds(app.db, user.id, user.tenant_id);
      const isPlatformRole = user.role === 'PLATFORM_OWNER';
      const permissions = getPermissionsForRole(user.role);

      const { refreshTokenRaw, refreshTokenHash, expMs, expiresAt } = generateRefreshToken(env.REFRESH_TOKEN_EXPIRES_IN);

      await app.db.insertInto('refresh_tokens').values({
        id: randomUUID(),
        tenant_id: user.tenant_id,
        user_id: user.id,
        token_hash: refreshTokenHash,
        expires_at: expiresAt,
        created_at: new Date(),
        revoked_at: null
      }).execute();

      setRefreshTokenCookie(reply, refreshTokenRaw, expMs, env.NODE_ENV === 'production');

      return await buildAuthResponse(
        app.jwt,
        user,
        branchIds,
        permissions,
        isPlatformRole,
        env.JWT_EXPIRES_IN
      );
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

      return await request.executeAsTenant(async (trx) => {
      const tenantIdParam = !request.auth!.isPlatformRole ? request.auth!.tenantId! : undefined;
      const user = await getUserForAuth(trx, request.auth!.userId, tenantIdParam);

      if (!user) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'Usuario no encontrado o inactivo');
      }

      if (user.tenant_status === 'SUSPENDED') {
        throw new AppError(403, 'AUTH_FORBIDDEN', 'El negocio se encuentra suspendido. Contacta al administrador de la plataforma.');
      }

      const branchIds = await getUserBranchIds(trx, user.id, user.tenant_id);
      const permissions = getPermissionsForRole(user.role);
      const isPlatformRole = user.role === 'PLATFORM_OWNER';

      return {
        user: buildUserDto(user, branchIds, permissions, isPlatformRole, { isImpersonating: request.auth!.isImpersonating })
      };
      });
    }
  );

  typedApp.put(
    '/auth/profile/pin',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
        body: z.object({
          new_pin: z.string().min(4).max(10)
        })
      }
    },
    async (request, reply) => {
      const { new_pin } = request.body;
      const { userId, role } = request.auth!;

      if (!['PLATFORM_OWNER', 'TENANT_OWNER', 'ADMIN', 'MANAGER'].includes(role)) {
        throw new AppError(403, 'FORBIDDEN', 'Solo administradores o mánagers pueden configurar un PIN de aprobación');
      }

      return await request.executeAsTenant(async (trx) => {
      const pinHash = await hashPassword(new_pin);

      await trx
        .updateTable('users')
        .set({ pin_hash: pinHash })
        .where('id', '=', userId)
        .execute();

      return reply.code(200).send({ message: 'PIN actualizado correctamente' });
      });
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
    async (request, _reply) => {
      const { session_id } = request.body;

      const session = await app.db.selectFrom('impersonation_sessions')
        .where('id', '=', session_id)
        .where('expires_at', '>', new Date())
        .where('revoked_at', 'is', null)
        .selectAll()
        .executeTakeFirst();

      if (!session) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'Sesión de suplantación inválida o expirada');
      }

      const user = await getUserForAuth(app.db, session.target_user_id);

      if (!user) {
        throw new AppError(403, 'AUTH_FORBIDDEN', 'El usuario objetivo no está disponible');
      }

      const branchIds = await getUserBranchIds(app.db, user.id, user.tenant_id);
      const permissions = getPermissionsForRole(user.role);
      const isPlatformRole = user.role === 'PLATFORM_OWNER';

      return await buildAuthResponse(
        app.jwt,
        user,
        branchIds,
        permissions,
        isPlatformRole,
        env.JWT_EXPIRES_IN,
        { isImpersonating: true }
      );
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
      const ip = request.ip;
      const key = buildIpRateLimitKey('refresh', ip);
      
      try {
        if (app.redis) {
          await assertAndRecordIpRateLimit(app.redis, key, 30, 60000);
        } else {
          assertAndRecordIpRateLimitSync(key, 30, 60000);
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'RATE_LIMIT_EXCEEDED') {
          return reply.status(429).send({ message: 'Too many requests' });
        }
        throw err;
      }

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

      let targetUserId = tokenRecord.user_id;
      let isImpersonating = false;
      
      const impersonationId = request.headers['x-impersonation-id'] as string;
      if (impersonationId) {
        const session = await app.db.selectFrom('impersonation_sessions')
          .where('id', '=', impersonationId)
          .where('expires_at', '>', new Date())
          .where('revoked_at', 'is', null)
          .selectAll()
          .executeTakeFirst();
          
        if (session && session.platform_user_id === tokenRecord.user_id) {
           targetUserId = session.target_user_id;
           isImpersonating = true;
        } else {
           throw new AppError(401, 'AUTH_UNAUTHORIZED', 'Sesión de suplantación inválida o expirada');
        }
      }

      // Verificamos que el usuario original siga activo
      const originalUser = await getUserForAuth(app.db, tokenRecord.user_id);
      if (!originalUser) {
        reply.clearCookie('pos_refresh_token', { path: '/' });
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'User not found or inactive');
      }

      const user = isImpersonating ? await getUserForAuth(app.db, targetUserId) : originalUser;

      if (!user) {
        reply.clearCookie('pos_refresh_token', { path: '/' });
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'User not found or inactive');
      }

      if (user.tenant_status === 'SUSPENDED') {
        reply.clearCookie('pos_refresh_token', { path: '/' });
        throw new AppError(403, 'AUTH_FORBIDDEN', 'El negocio se encuentra suspendido. Contacta al administrador de la plataforma.');
      }

      const { refreshTokenRaw, refreshTokenHash, expMs, expiresAt } = generateRefreshToken(env.REFRESH_TOKEN_EXPIRES_IN);

      await app.db.transaction().execute(async (trx) => {
        let updateQ = trx
          .updateTable('refresh_tokens')
          .set({ revoked_at: new Date() })
          .where('id', '=', tokenRecord.id);
        
        if (tokenRecord.tenant_id) {
            updateQ = updateQ.where('tenant_id', '=', tokenRecord.tenant_id);
        }
        await updateQ.execute();

        // Guardamos el token para el usuario ORIGINAL (PLATFORM_OWNER o usuario normal)
        await trx.insertInto('refresh_tokens').values({
          id: randomUUID(),
          tenant_id: originalUser.tenant_id,
          user_id: originalUser.id,
          token_hash: refreshTokenHash,
          expires_at: expiresAt,
          created_at: new Date(),
          revoked_at: null
        }).execute();
      });

      setRefreshTokenCookie(reply, refreshTokenRaw, expMs, env.NODE_ENV === 'production');

      const branchIds = await getUserBranchIds(app.db, user.id, user.tenant_id);
      const permissions = getPermissionsForRole(user.role);
      const isPlatformRole = user.role === 'PLATFORM_OWNER';

      return await buildAuthResponse(
        app.jwt,
        user,
        branchIds,
        permissions,
        isPlatformRole,
        env.JWT_EXPIRES_IN,
        isImpersonating ? { isImpersonating: true } : undefined
      );
    }
  );

  typedApp.post(
    '/auth/impersonate/stop',
    {
      schema: {
        tags: ['auth'],
        body: z.object({ session_id: z.string() })
      }
    },
    async (request, _reply) => {
      const { session_id } = request.body;

      await app.db.updateTable('impersonation_sessions')
        .set({ revoked_at: new Date() })
        .where('id', '=', session_id)
        .execute();

      return { success: true };
    }
  );
};
