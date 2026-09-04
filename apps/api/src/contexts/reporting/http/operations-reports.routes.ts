import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { OperationsReportsUseCase } from '../application/operations-reports.use-case.js';

/**
 * Informes de operación del restaurante.
 *
 * Cuatro preguntas de encargado: cuánto tarda una mesa en girar, cuánto tarda la cocina, a
 * qué horas se vende y qué platos merecen estar en la carta.
 */
const rangoSchema = z.object({
  branch_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD')
});

export const operationsReportsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  const base = {
    preHandler: [app.requirePermissions(['reports:view'])],
    schema: { tags: ['reporting'], security: [{ bearerAuth: [] }], querystring: rangoSchema }
  };

  typedApp.get('/reports/operations/table-turnover', base, async (request) =>
    request.executeAsTenant((trx) =>
      OperationsReportsUseCase.tableTurnover(trx, { tenantId: request.auth!.tenantId!, ...request.query, branchId: request.query.branch_id })
    )
  );

  typedApp.get('/reports/operations/prep-time', base, async (request) =>
    request.executeAsTenant((trx) =>
      OperationsReportsUseCase.prepTime(trx, { tenantId: request.auth!.tenantId!, ...request.query, branchId: request.query.branch_id })
    )
  );

  typedApp.get('/reports/operations/sales-by-hour', base, async (request) =>
    request.executeAsTenant((trx) =>
      OperationsReportsUseCase.salesByHour(trx, { tenantId: request.auth!.tenantId!, ...request.query, branchId: request.query.branch_id })
    )
  );

  typedApp.get('/reports/operations/menu-engineering', base, async (request) =>
    request.executeAsTenant((trx) =>
      OperationsReportsUseCase.menuEngineering(trx, { tenantId: request.auth!.tenantId!, ...request.query, branchId: request.query.branch_id })
    )
  );
};
