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
  role: z.enum(['ADMIN', 'CASHIER']),
  active: z.boolean().default(true)
});

export const adminUsersRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/admin/users',
    {
      preHandler: [app.requirePermissions(['settings:manage'])],
      schema: {
        tags: ['admin-users'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const users = await app.db
        .selectFrom('users')
        .select(['id', 'tenant_id', 'email', 'name', 'role', 'active', 'created_at'])
        .where('tenant_id', '=', request.auth.tenantId)
        .orderBy('created_at', 'desc')
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
      preHandler: [app.requirePermissions(['settings:manage'])],
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
      const passwordHash = await hashPassword(payload.password);

      const createdUser = await app.db
        .insertInto('users')
        .values({
          id: randomUUID(),
          tenant_id: request.auth.tenantId,
          email: payload.email,
          password_hash: passwordHash,
          name: payload.name,
          role: payload.role,
          active: payload.active
        })
        .returning(['id', 'tenant_id', 'email', 'name', 'role', 'active', 'created_at'])
        .executeTakeFirstOrThrow();

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
};
