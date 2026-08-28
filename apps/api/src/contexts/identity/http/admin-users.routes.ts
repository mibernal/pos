import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { hashPassword } from '../auth/password.js';
import { assertCanManageRole, assertIsNotSelfRoleChange } from '../../../shared/infra/security/role-guard.js';
import { QuotaGuard } from '../../../shared/infra/security/quota-guard.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { userRoleSchema } from '@pos-dian/shared';

const createUserBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  // Se toma del esquema compartido a propósito: escribir la lista a mano aquí fue lo que
  // dejó `WAITER` fuera del API durante meses.
  role: userRoleSchema,
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

      return await request.executeAsTenant(async (trx) => {
      let query = trx
        .selectFrom('users')
        .select((eb) => [
          'users.id', 
          'users.tenant_id', 
          'users.email', 
          'users.name', 
          'users.role', 
          'users.active', 
          'users.created_at',
          jsonArrayFrom(
            eb.selectFrom('user_branches')
              .select('user_branches.branch_id')
              .whereRef('user_branches.user_id', '=', 'users.id')
          ).as('branch_ids')
        ]);

      if (!request.auth!.isPlatformRole) {
        query = query.where('users.tenant_id', '=', request.auth!.tenantId!);
      } else {
        // Platform Owners shouldn't fetch all users globally by default
        query = query.where('users.tenant_id', 'is', null);
      }

      // Un gerente solo ve al personal de piso de sus propias sucursales.
      if (request.auth!.role !== 'ADMIN' && request.auth!.role !== 'TENANT_OWNER' && !request.auth!.isPlatformRole) {
        query = query
          .where('users.role', 'in', ['CASHIER', 'WAITER'])
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
        createdAt: user.created_at.toISOString(),
        branchIds: user.branch_ids.map(b => b.branch_id)
      }));
      });
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

      if (request.auth!.role !== 'ADMIN' && request.auth!.role !== 'TENANT_OWNER' && !request.auth!.isPlatformRole) {
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
      const targetTenantId = request.auth.isPlatformRole && payload.role === 'PLATFORM_OWNER' ? null : request.auth!.tenantId!;

      if (!targetTenantId && payload.role !== 'PLATFORM_OWNER') {
        throw new AppError(400, 'BAD_REQUEST', 'No se puede crear un usuario sin tenant_id a menos que sea PLATFORM_OWNER');
      }

      if (targetTenantId) {
        await QuotaGuard.assertCanCreateUser(app.db, targetTenantId);
      }

      return await request.executeAsTenant(async (trx) => {
      const createdUser = await (async () => {
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
      })();

      if (targetTenantId) {
          await writeAuditLog(trx, {
            tenantId: targetTenantId,
            userId: request.auth!.userId,
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
          role: userRoleSchema
        })
      }
    },
    async (request, _reply) => {
      if (!request.auth) throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');

      const targetUserId = request.params.id;
      const { role: newRole } = request.body;

      assertIsNotSelfRoleChange(request.auth.userId, targetUserId);

      return await request.executeAsTenant(async (trx) => {
      let query = trx
        .selectFrom('users')
        .select(['role', 'tenant_id'])
        .where('id', '=', targetUserId);

      if (!request.auth!.isPlatformRole) {
        query = query.where('tenant_id', '=', request.auth!.tenantId!);
      }

      const targetUser = await query.executeTakeFirst();
      if (!targetUser) throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado');

      // Actor must have power over the target's current role
      assertCanManageRole(request.auth!.role, targetUser.role);
      // Actor must also have power to assign the NEW role
      assertCanManageRole(request.auth!.role, newRole);



      await trx.updateTable('users')
        .set({ role: newRole })
        .where('id', '=', targetUserId)
        .execute();

      if (targetUser.tenant_id) {
        await writeAuditLog(trx, {
          tenantId: targetUser.tenant_id,
          userId: request.auth!.userId,
          entityType: 'USER',
          entityId: targetUserId,
          action: 'USER_ROLE_CHANGED',
          payloadJson: { previous: { role: targetUser.role }, current: { role: newRole } }
        });
      }

      return { success: true };
      });
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
    async (request, _reply) => {
      if (!request.auth) throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');

      const targetUserId = request.params.id;
      const { active } = request.body;

      assertIsNotSelfRoleChange(request.auth.userId, targetUserId);

      return await request.executeAsTenant(async (trx) => {
      let query = trx
        .selectFrom('users')
        .select(['role', 'active', 'tenant_id'])
        .where('id', '=', targetUserId);

      if (!request.auth!.isPlatformRole) {
        query = query.where('tenant_id', '=', request.auth!.tenantId!);
      }

      const targetUser = await query.executeTakeFirst();
      if (!targetUser) throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado');

      assertCanManageRole(request.auth!.role, targetUser.role);

      // Si el usuario estaba inactivo y se va a activar, revisar la cuota de usuarios activos.
      if (!targetUser.active && active && targetUser.tenant_id) {
        await QuotaGuard.assertCanCreateUser(trx as any, targetUser.tenant_id);
      }

      await trx.updateTable('users')
        .set({ active })
        .where('id', '=', targetUserId)
        .execute();

      // Revoke refresh tokens if suspended
      if (!active) {
          await trx.updateTable('refresh_tokens')
            .set({ revoked_at: new Date() })
            .where('user_id', '=', targetUserId)
            .where('revoked_at', 'is', null)
            .execute();
      }

      if (targetUser.tenant_id) {
        await writeAuditLog(trx, {
          tenantId: targetUser.tenant_id,
          userId: request.auth!.userId,
          entityType: 'USER',
          entityId: targetUserId,
          action: active ? 'USER_ACTIVATED' : 'USER_SUSPENDED',
          payloadJson: { previous: { active: targetUser.active }, current: { active } }
        });
      }

      return { success: true };
      });
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
    async (request, _reply) => {
      if (!request.auth) throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');

      const targetUserId = request.params.id;
      const { branch_ids } = request.body;

      return await request.executeAsTenant(async (trx) => {
      let query = trx
        .selectFrom('users')
        .select(['role', 'tenant_id'])
        .where('id', '=', targetUserId);

      if (!request.auth!.isPlatformRole) {
        query = query.where('tenant_id', '=', request.auth!.tenantId!);
      }

      const targetUserValidation = await query.executeTakeFirst();

      if (!targetUserValidation) {
        throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado');
      }

      if (request.auth!.role !== 'ADMIN' && request.auth!.role !== 'TENANT_OWNER' && !request.auth!.isPlatformRole) {
        const userBranchIds = request.auth!.branchIds || [];
        const allBranchesAllowed = branch_ids.every((bid) => userBranchIds.includes(bid));
        if (!allBranchesAllowed) {
          throw new AppError(403, 'AUTH_FORBIDDEN', 'No puedes asignar sucursales a las que no tienes acceso');
        }

        // Un gerente solo administra las sucursales del personal de piso: cajeros y meseros.
        if (targetUserValidation.role !== 'CASHIER' && targetUserValidation.role !== 'WAITER') {
          throw new AppError(403, 'AUTH_FORBIDDEN', 'Solo puedes modificar sucursales de cajeros y meseros');
        }
      }

      await (async () => {
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
      })();

      return { success: true };
      });
    }
  );
};
