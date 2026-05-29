import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { salesReportQuerySchema } from '@pos-dian/shared';

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/reports/sales',
    {
      preHandler: [app.requirePermissions(['reports:view'])],
      schema: {
        tags: ['reports'],
        security: [{ bearerAuth: [] }],
        querystring: salesReportQuerySchema
      }
    },
    async (request) => {
      const { branch_id, from, to } = request.query;

      let query = app.db
        .selectFrom('sales')
        .where('tenant_id', '=', request.auth!.tenantId)
        .where('branch_id', '=', branch_id)
        .where('status', '=', 'COMPLETED'); // Only count completed sales

      if (from) {
        query = query.where('created_at', '>=', new Date(from));
      }

      if (to) {
        query = query.where('created_at', '<=', new Date(to));
      }

      const rows = await query
        .select([
          sql<number>`COALESCE(SUM(total_cents), 0)`.as('total_revenue_cents'),
          sql<number>`COUNT(*)`.as('total_sales_count'),
          sql<number>`COALESCE(AVG(total_cents), 0)`.as('average_ticket_cents')
        ])
        .executeTakeFirst();

      // For revenue_by_method, we need to extract from payment_json.
      // Easiest is to select all matching sales payment_json and group in JS,
      // as payment_json is unstructured jsonb in a simple view. 
      // Kysely json functions can be complex across dialects, so querying JSON values:
      const salesQuery = app.db
        .selectFrom('sales')
        .select(['payment_json'])
        .where('tenant_id', '=', request.auth!.tenantId)
        .where('branch_id', '=', branch_id)
        .where('status', '=', 'COMPLETED');
        
      let salesFiltered = salesQuery;
      if (from) salesFiltered = salesFiltered.where('created_at', '>=', new Date(from));
      if (to) salesFiltered = salesFiltered.where('created_at', '<=', new Date(to));
      
      const salesData = await salesFiltered.execute();

      const methodRevenues: Record<string, number> = {
        CASH: 0,
        CARD: 0,
        TRANSFER: 0,
        MIXED: 0 // Ideally MIXED means split, so we iterate through sub-payments
      };

      salesData.forEach(sale => {
        const payment = sale.payment_json as Record<string, unknown> | null;
        if (!payment) return;
        
        if (payment.mode === 'MIXED' && Array.isArray(payment.payments)) {
          payment.payments.forEach((p: Record<string, unknown>) => {
            const method = p.method as string;
            methodRevenues[method] = (methodRevenues[method] || 0) + (Number(p.amount_cents) || 0);
          });
        } else {
          const method = payment.mode as string;
          methodRevenues[method] = (methodRevenues[method] || 0) + (Number(payment.total_cents) || 0);
        }
      });

      const revenue_by_method = Object.entries(methodRevenues)
        .filter(([, amount]) => amount > 0)
        .map(([method, amount_cents]) => ({
          method,
          amount_cents
        }));

      return {
        total_revenue_cents: Number(rows?.total_revenue_cents || 0),
        total_sales_count: Number(rows?.total_sales_count || 0),
        average_ticket_cents: Math.round(Number(rows?.average_ticket_cents || 0)),
        revenue_by_method
      };
    }
  );

  typedApp.get(
    '/reports/shifts',
    {
      preHandler: [app.requirePermissions(['reports:view'])],
      schema: {
        tags: ['reports'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      // Re-use salesReportQuerySchema structure manually or just extract from query
      const { branch_id, from, to } = request.query as Record<string, string | undefined>;

      let query = app.db
        .selectFrom('cash_sessions')
        .leftJoin('users', 'users.id', 'cash_sessions.opened_by_user_id')
        .where('cash_sessions.tenant_id', '=', request.auth!.tenantId);

      if (branch_id) {
        query = query.where('cash_sessions.branch_id', '=', branch_id);
      }

      if (from) {
        query = query.where('cash_sessions.opened_at', '>=', new Date(from));
      }

      if (to) {
        query = query.where('cash_sessions.opened_at', '<=', new Date(to));
      }

      const rows = await query
        .select([
          'cash_sessions.id',
          'cash_sessions.branch_id',
          'cash_sessions.opened_at',
          'cash_sessions.closed_at',
          'cash_sessions.opened_by_user_id',
          'users.name as user_name',
          'cash_sessions.opening_amount_cents',
          'cash_sessions.closing_cash_real_cents',
          'cash_sessions.expected_cash_cents',
          'cash_sessions.diff_cents'
        ])
        .orderBy('cash_sessions.opened_at', 'desc')
        .execute();

      return {
        items: rows.map(row => ({
          id: row.id,
          branch_id: row.branch_id,
          opened_at: row.opened_at.toISOString(),
          closed_at: row.closed_at ? row.closed_at.toISOString() : null,
          opened_by_user_id: row.opened_by_user_id,
          user_name: row.user_name ?? 'Desconocido',
          opening_amount_cents: row.opening_amount_cents,
          closing_cash_real_cents: row.closing_cash_real_cents,
          expected_cash_cents: row.expected_cash_cents,
          diff_cents: row.diff_cents
        }))
      };
    }
  );
};
