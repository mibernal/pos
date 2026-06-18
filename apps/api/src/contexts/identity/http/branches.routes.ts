import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { QuotaGuard } from '../../../shared/infra/security/quota-guard.js';

const createBranchBodySchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1)
});
export const branchesRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/branches',
    {
      preHandler: [app.requirePermissions(['branches:view'])],
      schema: {
        tags: ['branches'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      return await request.executeAsTenant(async (trx) => {
      let branchesQuery = trx
        .selectFrom('branches')
        .select(['id', 'tenant_id', 'name', 'address', 'created_at'])
        .where('tenant_id', '=', request.auth!.tenantId!)
        .orderBy('name', 'asc');

      if (request.auth!.role !== 'ADMIN' && request.auth!.role !== 'TENANT_OWNER' && !request.auth!.isPlatformRole) {
        const userBranchIds = request.auth!.branchIds || [];
        if (userBranchIds.length === 0) {
          return { items: [] };
        }
        branchesQuery = branchesQuery.where('id', 'in', userBranchIds);
      }

      const branches = await branchesQuery.execute();

      const openCashSessions = await trx
        .selectFrom('cash_sessions')
        .select(['id', 'branch_id', 'opened_at', 'opening_amount_cents'])
        .where('tenant_id', '=', request.auth!.tenantId!)
        .where('closed_at', 'is', null)
        .execute();

      const openSessionsByBranchId = new Map(
        openCashSessions.map((session) => [
          session.branch_id,
          {
            id: session.id,
            opened_at: session.opened_at.toISOString(),
            opening_amount_cents: session.opening_amount_cents
          }
        ])
      );

      return {
        items: branches.map((branch) => ({
          id: branch.id,
          tenant_id: branch.tenant_id,
          name: branch.name,
          address: branch.address,
          created_at: branch.created_at.toISOString(),
          current_cash_session: openSessionsByBranchId.get(branch.id) ?? null
        }))
      };
      });
    }
  );

  typedApp.post(
    '/branches',
    {
      preHandler: [app.requirePermissions(['branches:manage'])],
      schema: {
        tags: ['branches'],
        security: [{ bearerAuth: [] }],
        body: createBranchBodySchema
      }
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const payload = createBranchBodySchema.parse(request.body);

      return await request.executeAsTenant(async (trx) => {
      await QuotaGuard.assertCanCreateBranch(trx as any, request.auth!.tenantId!);

      const createdBranch = await trx
        .insertInto('branches')
        .values({
          id: randomUUID(),
          tenant_id: request.auth!.tenantId!,
          name: payload.name,
          address: payload.address
        })
        .returning(['id', 'tenant_id', 'name', 'address', 'created_at'])
        .executeTakeFirstOrThrow();

      return reply.code(201).send({
        id: createdBranch.id,
        tenant_id: createdBranch.tenant_id,
        name: createdBranch.name,
        address: createdBranch.address,
        created_at: createdBranch.created_at.toISOString()
      });
      });
    }
  );

  typedApp.patch(
    '/branches/:id',
    {
      preHandler: [app.requirePermissions(['branches:manage'])],
      schema: {
        tags: ['branches'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string().min(1).optional(),
          address: z.string().min(1).optional()
        })
      }
    },
    async (request, reply) => {
      if (!request.auth) throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');

      if (Object.keys(request.body).length === 0) {
        return reply.code(400).send({ message: 'No hay campos para actualizar' });
      }

      return await request.executeAsTenant(async (trx) => {
      const updated = await trx
        .updateTable('branches')
        .set(request.body)
        .where('id', '=', request.params.id)
        .where('tenant_id', '=', request.auth!.tenantId!)
        .returning(['id', 'tenant_id', 'name', 'address', 'created_at'])
        .executeTakeFirst();

      if (!updated) {
        throw new AppError(404, 'NOT_FOUND', 'Sucursal no encontrada');
      }

      return reply.send({
        id: updated.id,
        tenant_id: updated.tenant_id,
        name: updated.name,
        address: updated.address,
        created_at: updated.created_at.toISOString()
      });
      });
    }
  );
};
