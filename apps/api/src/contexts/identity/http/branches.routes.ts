import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';

export const branchesRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/branches',
    {
      preHandler: [app.requirePermissions(['products:view'])],
      schema: {
        tags: ['branches'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const branches = await app.db
        .selectFrom('branches')
        .select(['id', 'tenant_id', 'name', 'address', 'created_at'])
        .where('tenant_id', '=', request.auth.tenantId)
        .orderBy('name', 'asc')
        .execute();

      const openCashSessions = await app.db
        .selectFrom('cash_sessions')
        .select(['id', 'branch_id', 'opened_at', 'opening_amount_cents'])
        .where('tenant_id', '=', request.auth.tenantId)
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
    }
  );
};
