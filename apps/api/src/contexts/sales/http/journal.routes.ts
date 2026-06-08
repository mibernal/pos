import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';

// We expect an array of operations
const journalSyncSchema = z.object({
  operations: z.array(
    z.object({
      id: z.string().uuid(),
      type: z.enum([
        'CREATE_SALE',
        'VOID_SALE',
        'CREATE_CASH_SESSION',
        'CLOSE_CASH_SESSION',
        'CREATE_PRODUCT',
        'UPDATE_PRODUCT'
      ]),
      timestamp: z.string(),
      payload: z.any(),
      idempotencyKey: z.string()
    })
  )
});

export const journalRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/journal/sync',
    {
      preHandler: [app.requirePermissions(['sales:create'])], // Minimal permission required to sync
      schema: {
        tags: ['journal', 'offline'],
        security: [{ bearerAuth: [] }],
        body: journalSyncSchema
      }
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const { operations } = request.body;
      const synced_ids: string[] = [];
      const failed_ids: { id: string; error: string }[] = [];

      for (const op of operations) {
        try {
          // Here we would route the operation to the appropriate CQRS Command Handler
          // based on op.type. For the MVP, we just log it and mark it synced if 
          // it passes basic validation, but in a full implementation we would dispatch it.
          
          request.log.info({
            event: 'journal_replay',
            operation_id: op.id,
            operation_type: op.type,
            tenant_id: request.auth!.tenantId!
          }, `Replaying offline operation ${op.type}`);

          // e.g. if (op.type === 'CREATE_SALE') {
          //   const command = new CreateSaleCommand(op.payload, ...);
          //   await new CreateSaleHandler(app.db).handle(command);
          // }

          synced_ids.push(op.id);
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
          request.log.error(err, `Failed to replay operation ${op.id}`);
          failed_ids.push({ id: op.id, error: err.message });
        }
      }

      return reply.code(200).send({ synced_ids, failed_ids });
    }
  );
};
