import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { hashPassword } from '../auth/password.js';
import { assertCanManageRole, assertIsNotSelfRoleChange } from '../../../shared/infra/security/role-guard.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';

const createUserBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(['PLATFORM_OWNER', 'TENANT_OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR']),
  active: z.boolean().default(true),
  branch_ids: z.array(z.string().uuid()).optional()
});

export const adminUsersRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/admin/users',
    {
      preHandler: [app.requirePermissions(['users:manage'])],
      schema: {
        tags: ['admin-users'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      let query = app.db
        .selectFrom('users')
        .select(['users.id', 'users.tenant_id', 'users.email', 'users.name', 'users.role', 'users.active', 'users.created_at']);

      if (!request.auth.isPlatformRole) {
        query = query.where('users.tenant_id', '=', request.auth.tenantId);
      }

      // Managers can only see CASHIERS in their own branches
      if (request.auth.role !== 'ADMIN' && request.auth.role !== 'TENANT_OWNER' && !request.auth.isPlatformRole) {
        query = query
          .where('users.role', '=', 'CASHIER')
          .where(({ exists, selectFrom }) =>
            exists(
              selectFrom('user_branches as ub')
                .select('ub.branch_id')
                .whereRef('ub.user_id', '=', 'users.id')
                .where('ub.branch_id', 'in', request.auth!.branchIds)
            )
          );
      }

      const users = await query
        .orderBy('users.created_at', 'desc')
        .execute();

      return users.map((user) => ({
        id: user.id,
        tenantId: user.tenant_id,
        email: user.email,
        name: user.name,
        role: user.role,
        active: user.active,
        createdAt: user.created_at.toISOString()
      }));
    }
  );

  typedApp.post(
    '/admin/users',
    {
      preHandler: [app.requirePermissions(['users:manage'])],
      schema: {
        tags: ['admin-users'],
        security: [{ bearerAuth: [] }],
        body: createUserBodySchema
      }
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const payload = createUserBodySchema.parse(request.body);

      // Hierarchical Role Validation
      assertCanManageRole(request.auth.role, payload.role);

      if (request.auth.role !== 'ADMIN' && request.auth.role !== 'TENANT_OWNER' && !request.auth.isPlatformRole) {
        if (payload.branch_ids && payload.branch_ids.length > 0) {
          const userBranchIds = request.auth.branchIds || [];
          const allBranchesAllowed = payload.branch_ids.every((bid) => userBranchIds.includes(bid));
          if (!allBranchesAllowed) {
            throw new AppError(403, 'AUTH_FORBIDDEN', 'No puedes asignar sucursales a las que no tienes acceso');
          }
        }
      }

      const passwordHash = await hashPassword(payload.password);
      const newUserId = randomUUID();
      const targetTenantId = request.auth.isPlatformRole && payload.role === 'PLATFORM_OWNER' ? null : request.auth.tenantId;

      if (targetTenantId && (payload.role === 'MANAGER' || payload.role === 'AUDITOR')) {
        const tenant = await app.db.selectFrom('tenants').select('plan').where('id', '=', targetTenantId).executeTakeFirst();
        if (tenant?.plan === 'STARTER') {
          throw new AppError(403, 'AUTH_FORBIDDEN', 'El plan actual de la cuenta no permite usar este rol. Mejora tu plan para continuar.');
        }
      }

      const createdUser = await app.db.transaction().execute(async (trx) => {
        const user = await trx
          .insertInto('users')
          .values({
            id: newUserId,
            tenant_id: targetTenantId,
            email: payload.email,
            password_hash: passwordHash,
            name: payload.name,
            role: payload.role,
            active: payload.active
          })
          .returning(['id', 'tenant_id', 'email', 'name', 'role', 'active', 'created_at'])
          .executeTakeFirstOrThrow();

        if (payload.branch_ids && payload.branch_ids.length > 0 && targetTenantId) {
          const values = payload.branch_ids.map((bid) => ({
            tenant_id: targetTenantId,
            user_id: newUserId,
            branch_id: bid
          }));
          await trx.insertInto('user_branches').values(values).execute();
        }

        return user;
      });

      if (targetTenantId) {
          await writeAuditLog(app.db, {
            tenantId: targetTenantId,
            userId: request.auth.userId,
            entityType: 'USER',
            entityId: newUserId,
            action: 'USER_CREATED',
            payloadJson: { current: { email: payload.email, role: payload.role } }
          });
      }

      return reply.code(201).send({
        id: createdUser.id,
        tenantId: createdUser.tenant_id,
        email: createdUser.email,
        name: createdUser.name,
        role: createdUser.role,
        active: createdUser.active,
        createdAt: createdUser.created_at.toISOString()
      });
    }
  );

  typedApp.patch(
    '/admin/users/:id/role',
    {
      preHandler: [app.requirePermissions(['users:manage'])],
      schema: {
        tags: ['admin-users'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          role: z.enum(['PLATFORM_OWNER', 'TENANT_OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR'])
        })
      }
    },
    async (request, reply) => {
      if (!request.auth) throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');

      const targetUserId = request.params.id;
      const { role: newRole } = request.body;

      assertIsNotSelfRoleChange(request.auth.userId, targetUserId);

      let query = app.db
        .selectFrom('users')
        .select(['role', 'tenant_id'])
        .where('id', '=', targetUserId);

      if (!request.auth.isPlatformRole) {
        query = query.where('tenant_id', '=', request.auth.tenantId);
      }

      const targetUser = await query.executeTakeFirst();
      if (!targetUser) throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado');

      // Actor must have power over the target's current role
      assertCanManageRole(request.auth.role, targetUser.role);
      // Actor must also have power to assign the NEW role
      assertCanManageRole(request.auth.role, newRole);

      if (targetUser.tenant_id && (newRole === 'MANAGER' || newRole === 'AUDITOR')) {
        const tenant = await app.db.selectFrom('tenants').select('plan').where('id', '=', targetUser.tenant_id).executeTakeFirst();
        if (tenant?.plan === 'STARTER') {
          throw new AppError(403, 'AUTH_FORBIDDEN', 'El plan actual de la cuenta no permite usar este rol. Mejora tu plan para continuar.');
        }
      }

      await app.db.updateTable('users')
        .set({ role: newRole })
        .where('id', '=', targetUserId)
        .execute();

      if (targetUser.tenant_id) {
        await writeAuditLog(app.db, {
          tenantId: targetUser.tenant_id,
          userId: request.auth.userId,
          entityType: 'USER',
          entityId: targetUserId,
          action: 'USER_ROLE_CHANGED',
          payloadJson: { previous: { role: targetUser.role }, current: { role: newRole } }
        });
      }

      return reply.send({ success: true });
    }
  );

  typedApp.patch(
    '/admin/users/:id/status',
    {
      preHandler: [app.requirePermissions(['users:manage'])],
      schema: {
        tags: ['admin-users'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          active: z.boolean()
        })
      }
    },
    async (request, reply) => {
      if (!request.auth) throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');

      const targetUserId = request.params.id;
      const { active } = request.body;

      assertIsNotSelfRoleChange(request.auth.userId, targetUserId);

      let query = app.db
        .selectFrom('users')
        .select(['role', 'active', 'tenant_id'])
        .where('id', '=', targetUserId);

      if (!request.auth.isPlatformRole) {
        query = query.where('tenant_id', '=', request.auth.tenantId);
      }

      const targetUser = await query.executeTakeFirst();
      if (!targetUser) throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado');

      assertCanManageRole(request.auth.role, targetUser.role);

      await app.db.updateTable('users')
        .set({ active })
        .where('id', '=', targetUserId)
        .execute();

      // Revoke refresh tokens if suspended
      if (!active) {
          await app.db.updateTable('refresh_tokens')
            .set({ revoked_at: new Date() })
            .where('user_id', '=', targetUserId)
            .where('revoked_at', 'is', null)
            .execute();
      }

      if (targetUser.tenant_id) {
        await writeAuditLog(app.db, {
          tenantId: targetUser.tenant_id,
          userId: request.auth.userId,
          entityType: 'USER',
          entityId: targetUserId,
          action: active ? 'USER_ACTIVATED' : 'USER_SUSPENDED',
          payloadJson: { previous: { active: targetUser.active }, current: { active } }
        });
      }

      return reply.send({ success: true });
    }
  );

  typedApp.patch(
    '/admin/users/:id/branches',
    {
      preHandler: [app.requirePermissions(['users:manage'])],
      schema: {
        tags: ['admin-users'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          branch_ids: z.array(z.string().uuid())
        })
      }
    },
    async (request, reply) => {
      if (!request.auth) throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');

      const targetUserId = request.params.id;
      const { branch_ids } = request.body;

      let query = app.db
        .selectFrom('users')
        .select(['role', 'tenant_id'])
        .where('id', '=', targetUserId);

      if (!request.auth.isPlatformRole) {
        query = query.where('tenant_id', '=', request.auth.tenantId);
      }

      const targetUserValidation = await query.executeTakeFirst();

      if (!targetUserValidation) {
        throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado');
      }

      if (request.auth.role !== 'ADMIN' && request.auth.role !== 'TENANT_OWNER' && !request.auth.isPlatformRole) {
        const userBranchIds = request.auth.branchIds || [];
        const allBranchesAllowed = branch_ids.every((bid) => userBranchIds.includes(bid));
        if (!allBranchesAllowed) {
          throw new AppError(403, 'AUTH_FORBIDDEN', 'No puedes asignar sucursales a las que no tienes acceso');
        }

        // Verify target user is only CASHIER
        if (targetUserValidation.role !== 'CASHIER') {
          throw new AppError(403, 'AUTH_FORBIDDEN', 'Solo puedes modificar sucursales de cajeros');
        }
      }

      await app.db.transaction().execute(async (trx) => {
        // Delete old branches for this user
        let deleteQ = trx.deleteFrom('user_branches').where('user_id', '=', targetUserId);
        if (!request.auth!.isPlatformRole) {
            deleteQ = deleteQ.where('tenant_id', '=', request.auth!.tenantId!);
        }
        await deleteQ.execute();

        // Insert new ones
        if (branch_ids.length > 0) {
          const values = branch_ids.map((bid) => ({
            tenant_id: targetUserValidation.tenant_id!,
            user_id: targetUserId,
            branch_id: bid
          }));
          await trx.insertInto('user_branches').values(values).execute();
        }
      });

      return reply.send({ success: true });
    }
  );
};
