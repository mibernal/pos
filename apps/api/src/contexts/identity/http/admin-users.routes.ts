import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { hashPassword } from '../auth/password.js';

const createUserBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR']),
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
        .select(['users.id', 'users.tenant_id', 'users.email', 'users.name', 'users.role', 'users.active', 'users.created_at'])
        .where('users.tenant_id', '=', request.auth.tenantId);

      // Managers can only see CASHIERS in their own branches
      if (request.auth.role !== 'ADMIN') {
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

      if (request.auth.role !== 'ADMIN') {
        if (payload.role !== 'CASHIER') {
          throw new AppError(403, 'AUTH_FORBIDDEN', 'Solo puedes crear usuarios con rol CASHIER');
        }
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

      const createdUser = await app.db.transaction().execute(async (trx) => {
        const user = await trx
          .insertInto('users')
          .values({
            id: newUserId,
            tenant_id: request.auth!.tenantId,
            email: payload.email,
            password_hash: passwordHash,
            name: payload.name,
            role: payload.role,
            active: payload.active
          })
          .returning(['id', 'tenant_id', 'email', 'name', 'role', 'active', 'created_at'])
          .executeTakeFirstOrThrow();

        if (payload.branch_ids && payload.branch_ids.length > 0) {
          const values = payload.branch_ids.map((bid) => ({
            tenant_id: request.auth!.tenantId,
            user_id: newUserId,
            branch_id: bid
          }));
          await trx.insertInto('user_branches').values(values).execute();
        }

        return user;
      });

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

      // MED-007: Validar siempre que el target user pertenece a este tenant
      const targetUserValidation = await app.db
        .selectFrom('users')
        .select(['role'])
        .where('id', '=', targetUserId)
        .where('tenant_id', '=', request.auth.tenantId)
        .executeTakeFirst();

      if (!targetUserValidation) {
        throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado en este tenant');
      }

      if (request.auth.role !== 'ADMIN') {
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
        await trx
          .deleteFrom('user_branches')
          .where('user_id', '=', targetUserId)
          .where('tenant_id', '=', request.auth!.tenantId)
          .execute();

        // Insert new ones
        if (branch_ids.length > 0) {
          const values = branch_ids.map((bid) => ({
            tenant_id: request.auth!.tenantId,
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
