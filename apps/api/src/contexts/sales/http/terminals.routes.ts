import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';

import { ensureUserCanAccessBranch } from '../../../shared/infra/security/permissions.js';

const terminalSchema = z.object({ // eslint-disable-line @typescript-eslint/no-unused-vars
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  name: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string()
});

const createTerminalBodySchema = z.object({
  branch_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  is_active: z.boolean().optional().default(true)
});

const getTerminalsQuerySchema = z.object({
  branch_id: z.string().uuid().optional()
});

export const terminalsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/terminals',
    {
      preHandler: [app.requirePermissions(['terminals:manage'])],
      schema: {
        tags: ['terminals'],
        security: [{ bearerAuth: [] }],
        body: createTerminalBodySchema
      }
    },
    async (request, reply) => {
      if (!request.auth) throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');

      const payload = createTerminalBodySchema.parse(request.body);
      
      ensureUserCanAccessBranch(request.auth!, payload.branch_id);

      return await request.executeAsTenant(async (trx) => {
      // Verify branch
      const branch = await trx
        .selectFrom('branches')
        .select('id')
        .where('tenant_id', '=', request.auth!.tenantId!)
        .where('id', '=', payload.branch_id)
        .executeTakeFirst();
      
      if (!branch) {
        throw new AppError(404, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');
      }

      try {
        const terminal = await trx
          .insertInto('terminals')
          .values({
            id: randomUUID(),
            tenant_id: request.auth!.tenantId!,
            branch_id: payload.branch_id,
            name: payload.name,
            is_active: payload.is_active
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        return reply.code(201).send({ terminal: { ...terminal, created_at: terminal.created_at.toISOString(), updated_at: terminal.updated_at.toISOString() } });
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (err.code === '23505') {
          throw new AppError(409, 'TERMINAL_EXISTS', 'Ya existe una terminal con ese nombre en esta sucursal');
        }
        throw err;
      }
      });
    }
  );

  typedApp.get(
    '/terminals',
    {
      preHandler: [app.requirePermissions(['terminals:view'])],
      schema: {
        tags: ['terminals'],
        security: [{ bearerAuth: [] }],
        querystring: getTerminalsQuerySchema
      }
    },
    async (request) => {
      if (!request.auth) throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      
      const query = getTerminalsQuerySchema.parse(request.query);

      if (query.branch_id) {
        ensureUserCanAccessBranch(request.auth!, query.branch_id);
      }

      return await request.executeAsTenant(async (trx) => {
      let dbQuery = trx
        .selectFrom('terminals')
        .selectAll()
        .where('tenant_id', '=', request.auth!.tenantId!);

      if (query.branch_id) {
        dbQuery = dbQuery.where('branch_id', '=', query.branch_id);
      }

      const terminals = await dbQuery.orderBy('name', 'asc').execute();

      return { terminals: terminals.map(t => ({ ...t, created_at: t.created_at.toISOString(), updated_at: t.updated_at.toISOString() })) };
      });
    }
  );
};
