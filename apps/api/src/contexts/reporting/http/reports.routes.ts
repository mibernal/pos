import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { salesReportQuerySchema, kardexQuerySchema, waiterReportQuerySchema } from '@pos-dian/shared';
import { WaiterReportsUseCase } from '../application/waiter-reports.use-case.js';

import { AppError } from '../../../shared/infra/errors/app-error.js';
import { ensureUserCanAccessBranch } from '../../../shared/infra/security/permissions.js';

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
      if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'No autorizado');
      const { branch_id, from, to } = request.query;

      if (branch_id) ensureUserCanAccessBranch(request.auth, branch_id);

      return await request.executeAsTenant(async (trx) => {
      let query = trx
        .selectFrom('sales')
        .where('tenant_id', '=', request.auth!.tenantId!)
        .where('status', '=', 'COMPLETED'); // Only count completed sales

      if (branch_id) {
        query = query.where('branch_id', '=', branch_id as string);
      } else if (request.auth!.role !== 'ADMIN' && request.auth!.role !== 'TENANT_OWNER' && !request.auth!.isPlatformRole) {
        query = query.where('branch_id', 'in', request.auth!.branchIds);
      }

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
      let salesFiltered = trx
        .selectFrom('sales')
        .select(['payment_json'])
        .where('tenant_id', '=', request.auth!.tenantId!)
        .where('status', '=', 'COMPLETED');

      if (branch_id) {
        salesFiltered = salesFiltered.where('branch_id', '=', branch_id as string);
      } else if (request.auth!.role !== 'ADMIN' && request.auth!.role !== 'TENANT_OWNER' && !request.auth!.isPlatformRole) {
        salesFiltered = salesFiltered.where('branch_id', 'in', request.auth!.branchIds);
      }
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
      });
    }
  );

  typedApp.get(
    '/reports/waiters',
    {
      preHandler: [app.requirePermissions(['reports:view'])],
      schema: {
        tags: ['reports'],
        security: [{ bearerAuth: [] }],
        querystring: waiterReportQuerySchema
      }
    },
    async (request) => {
      if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'No autorizado');
      const { branch_id } = request.query;
      if (branch_id) ensureUserCanAccessBranch(request.auth, branch_id);

      const useCase = new WaiterReportsUseCase(app.db);
      return await useCase.execute(request.auth.tenantId!, request.query);
    }
  );

  typedApp.get(
    '/reports/shifts',
    {
      preHandler: [app.requirePermissions(['reports:view'])],
      schema: {
        tags: ['reports'],
        security: [{ bearerAuth: [] }],
        querystring: salesReportQuerySchema
      }
    },
    async (request) => {
      if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'No autorizado');
      
      const { branch_id, from, to } = request.query;

      if (branch_id) ensureUserCanAccessBranch(request.auth, branch_id);

      return await request.executeAsTenant(async (trx) => {
      let query = trx
        .selectFrom('cash_sessions')
        .leftJoin('users', 'users.id', 'cash_sessions.opened_by_user_id')
        .where('cash_sessions.tenant_id', '=', request.auth!.tenantId!);

      if (branch_id) {
        query = query.where('cash_sessions.branch_id', '=', branch_id as string);
      } else if (request.auth!.role !== 'ADMIN' && request.auth!.role !== 'TENANT_OWNER' && !request.auth!.isPlatformRole) {
        query = query.where('cash_sessions.branch_id', 'in', request.auth!.branchIds);
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
      });
    }
  );

  typedApp.get(
    '/reports/kardex',
    {
      preHandler: [app.requirePermissions(['reports:view'])], // Or inventory:view
      schema: {
        tags: ['reports'],
        security: [{ bearerAuth: [] }],
        querystring: kardexQuerySchema
      }
    },
    async (request) => {
      if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'No autorizado');
      const { branch_id, product_id, variant_id, from, to } = request.query;

      ensureUserCanAccessBranch(request.auth, branch_id);

      return await request.executeAsTenant(async (trx) => {
      let query = trx
        .selectFrom('inventory_transactions')
        .leftJoin('users', 'users.id', 'inventory_transactions.created_by_user_id')
        .where('inventory_transactions.tenant_id', '=', request.auth!.tenantId!)
        .where('inventory_transactions.branch_id', '=', branch_id)
        .where('inventory_transactions.product_id', '=', product_id);

      if (variant_id) {
        query = query.where('inventory_transactions.variant_id', '=', variant_id);
      } else {
        query = query.where('inventory_transactions.variant_id', 'is', null);
      }

      if (from) {
        query = query.where('inventory_transactions.created_at', '>=', new Date(from));
      }
      if (to) {
        query = query.where('inventory_transactions.created_at', '<=', new Date(to));
      }

      const rows = await query
        .select([
          'inventory_transactions.id',
          'inventory_transactions.operation',
          'inventory_transactions.reference_id',
          'inventory_transactions.qty_change',
          'inventory_transactions.balance_after',
          'inventory_transactions.notes',
          'inventory_transactions.created_at',
          'users.name as user_name'
        ])
        .orderBy('inventory_transactions.created_at', 'desc')
        .execute();

      return {
        items: rows.map(r => ({
          ...r,
          qty_change: Number(r.qty_change),
          balance_after: r.balance_after ? Number(r.balance_after) : null,
          created_at: r.created_at.toISOString()
        }))
      };
      });
    }
  );
};
