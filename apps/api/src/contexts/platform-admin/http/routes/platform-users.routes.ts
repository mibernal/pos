import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ListUsersUseCase } from '../../application/tenant-users/list-users.use-case.js';
import { CreateUserUseCase } from '../../application/tenant-users/create-user.use-case.js';
import { UpdateUserUseCase } from '../../application/tenant-users/update-user.use-case.js';
import { DeleteUserUseCase } from '../../application/tenant-users/delete-user.use-case.js';

const createTenantUserBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(['TENANT_OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR']),
  active: z.boolean().default(true)
});

const updateTenantUserBodySchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['TENANT_OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR']).optional(),
  active: z.boolean().optional()
});

export const platformUsersRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get('/platform/tenants/:id/users', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'List users of a tenant',
      params: z.object({ id: z.string() })
    }
  }, async (request) => {
    const useCase = new ListUsersUseCase(app.db);
    const users = await useCase.execute(request.params.id);
    return { users };
  });

  typedApp.post('/platform/tenants/:id/users', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Create a user for a tenant',
      params: z.object({ id: z.string() }),
      body: createTenantUserBodySchema
    }
  }, async (request, reply) => {
    const useCase = new CreateUserUseCase(app.db);
    const user = await useCase.execute(request.params.id, request.body as any, request.auth!.userId, request.auth!.email);
    return reply.code(201).send({ user });
  });

  typedApp.patch('/platform/tenants/:id/users/:userId', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Update a user of a tenant',
      params: z.object({ id: z.string(), userId: z.string() }),
      body: updateTenantUserBodySchema
    }
  }, async (request) => {
    const useCase = new UpdateUserUseCase(app.db);
    await useCase.execute(request.params.id, request.params.userId, request.body as any, request.auth!.userId, request.auth!.email);
    return { success: true };
  });

  typedApp.delete('/platform/tenants/:id/users/:userId', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Delete a user from a tenant',
      params: z.object({ id: z.string(), userId: z.string() })
    }
  }, async (request) => {
    const useCase = new DeleteUserUseCase(app.db);
    await useCase.execute(request.params.id, request.params.userId, request.auth!.userId, request.auth!.email);
    return { success: true };
  });
};
