import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import {
  salesReportQuerySchema,
  kardexQuerySchema,
  waiterReportQuerySchema,
  PAYMENT_KIND_BEHAVIOR,
  type PaymentKind
} from '@pos-dian/shared';
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

      /**
       * Ingresos por medio de pago, desde `sale_payments`.
       *
       * Antes esto traía a memoria el `payment_json` de **todas** las ventas del rango y
       * las agrupaba en JavaScript, con su propio objeto literal de cuatro claves —una de
       * ellas `MIXED`, que no es un medio de pago sino la ausencia de uno—. Además del
       * coste, cualquier medio nuevo caía fuera del informe sin avisar. Ahora es un
       * `GROUP BY` y el desglose lo arma el mismo código que usa el reporte Z.
       */
      let paymentsQuery = trx
        .selectFrom('sale_payments as sp')
        .innerJoin('sales as s', 's.id', 'sp.sale_id')
        .leftJoin('payment_method_catalog as c', (join) =>
          join.onRef('c.tenant_id', '=', 'sp.tenant_id').onRef('c.code', '=', 'sp.method_code')
        )
        .select((eb) => [
          'sp.method_code',
          'sp.kind',
          'c.label',
          eb.fn.sum<number>('sp.amount_cents').as('amount_cents'),
          eb.fn.count<number>('sp.id').as('count')
        ])
        .where('sp.tenant_id', '=', request.auth!.tenantId!)
        .where('s.status', '=', 'COMPLETED')
        .groupBy(['sp.method_code', 'sp.kind', 'c.label']);

      if (branch_id) {
        paymentsQuery = paymentsQuery.where('sp.branch_id', '=', branch_id as string);
      } else if (request.auth!.role !== 'ADMIN' && request.auth!.role !== 'TENANT_OWNER' && !request.auth!.isPlatformRole) {
        paymentsQuery = paymentsQuery.where('sp.branch_id', 'in', request.auth!.branchIds);
      }
      if (from) paymentsQuery = paymentsQuery.where('sp.created_at', '>=', new Date(from));
      if (to) paymentsQuery = paymentsQuery.where('sp.created_at', '<=', new Date(to));

      const paymentRows = await paymentsQuery.execute();

      const revenue_by_method = paymentRows
        .map((row) => {
          const kind = row.kind as PaymentKind;
          const behavior = PAYMENT_KIND_BEHAVIOR[kind];
          return {
            method: row.method_code,
            kind,
            label: row.label ?? behavior.label,
            group: behavior.group,
            amount_cents: Number(row.amount_cents),
            count: Number(row.count)
          };
        })
        .filter((row) => row.amount_cents > 0)
        .sort((a, b) => b.amount_cents - a.amount_cents);


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

      // Dentro del contexto de comercio. Iba contra `app.db` sin fijar `app.current_tenant`:
      // con RLS forzado y el rol de la API sin BYPASSRLS, `sales` devolvía cero filas y el
      // informe salía vacío en producción sin que nada fallara.
      return await request.executeAsTenant(async (trx) => {
        const useCase = new WaiterReportsUseCase(trx as unknown as typeof app.db);
        return await useCase.execute(request.auth!.tenantId!, request.query);
      });
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
