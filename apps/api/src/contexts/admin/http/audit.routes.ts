import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const auditRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/admin/audit-logs',
    {
      preHandler: [app.requirePermissions(['audit:view'])],
      schema: {
        tags: ['admin', 'audit'],
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          branch_id: z.string().uuid().optional(),
          user_id: z.string().uuid().optional(),
          entity_type: z.string().optional(),
          action: z.string().optional(),
          limit: z.coerce.number().min(1).max(500).default(50),
          offset: z.coerce.number().min(0).default(0)
        })
      }
    },
    async (request) => {
      const { tenantId } = request.auth!;
      const query = request.query;

      let q = app.db
        .selectFrom('audit_logs')
        .where('tenant_id', '=', tenantId)
        .leftJoin('users', 'users.id', 'audit_logs.user_id')
        .leftJoin('branches', 'branches.id', 'audit_logs.branch_id')
        .select([
          'audit_logs.id',
          'audit_logs.entity_type',
          'audit_logs.entity_id',
          'audit_logs.action',
          'audit_logs.created_at',
          'audit_logs.ip_address',
          'audit_logs.correlation_id',
          'users.name as user_name',
          'users.email as user_email',
          'branches.name as branch_name'
        ]);

      if (query.branch_id) q = q.where('audit_logs.branch_id', '=', query.branch_id);
      if (query.user_id) q = q.where('audit_logs.user_id', '=', query.user_id);
      if (query.entity_type) q = q.where('audit_logs.entity_type', '=', query.entity_type);
      if (query.action) q = q.where('audit_logs.action', '=', query.action);

      const items = await q
        .orderBy('audit_logs.created_at', 'desc')
        .limit(query.limit)
        .offset(query.offset)
        .execute();

      // Total count (approx or accurate depending on partition sizes, here we do accurate for simplicity assuming filters)
      let countQ = app.db
        .selectFrom('audit_logs')
        .where('tenant_id', '=', tenantId)
        .select(app.db.fn.count<number>('id').as('count'));
      
      if (query.branch_id) countQ = countQ.where('branch_id', '=', query.branch_id);
      if (query.user_id) countQ = countQ.where('user_id', '=', query.user_id);
      if (query.entity_type) countQ = countQ.where('entity_type', '=', query.entity_type);
      if (query.action) countQ = countQ.where('action', '=', query.action);

      const totalResult = await countQ.executeTakeFirst();

      return {
        items,
        total: Number(totalResult?.count || 0)
      };
    }
  );

  typedApp.get(
    '/admin/audit-logs/:correlation_id',
    {
      preHandler: [app.requirePermissions(['audit:view'])],
      schema: {
        tags: ['admin', 'audit'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          correlation_id: z.string().uuid()
        })
      }
    },
    async (request) => {
      const { tenantId } = request.auth!;
      const { correlation_id } = request.params;

      const items = await app.db
        .selectFrom('audit_logs')
        .where('tenant_id', '=', tenantId)
        .where('correlation_id', '=', correlation_id)
        .leftJoin('users', 'users.id', 'audit_logs.user_id')
        .select([
          'audit_logs.id',
          'audit_logs.entity_type',
          'audit_logs.entity_id',
          'audit_logs.action',
          'audit_logs.created_at',
          'audit_logs.ip_address',
          'audit_logs.user_agent',
          'audit_logs.legacy_payload',
          'audit_logs.old_values',
          'audit_logs.new_values',
          'users.name as user_name'
        ])
        .orderBy('audit_logs.created_at', 'asc')
        .execute();

      return {
        correlation_id,
        items
      };
    }
  );
};
