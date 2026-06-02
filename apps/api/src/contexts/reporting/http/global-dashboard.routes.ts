import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { AppError } from '../../../shared/infra/errors/app-error.js';

export const globalDashboardRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Global Dashboard Endpoint (Fast due to Rollups)
  typedApp.get(
    '/dashboard/global',
    {
      preHandler: [app.requirePermissions(['dashboard:global:view'])], // Require ADMIN or global view
      schema: {
        tags: ['dashboard'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'No autorizado');
      const { tenantId } = request.auth;

      const todayStr = new Date().toISOString().split('T')[0];
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Top-Level KPIs
      let todaySalesQuery = app.db
        .selectFrom('daily_branch_sales_rollup')
        .where('tenant_id', '=', tenantId)
        .where('date', '=', todayStr as any);

      if (request.auth!.role !== 'ADMIN') {
        todaySalesQuery = todaySalesQuery.where('branch_id', 'in', request.auth!.branchIds);
      }

      const todaySales = await todaySalesQuery
        .select([
          sql<number>`COALESCE(SUM(total_revenue_cents), 0)`.as('global_revenue_cents'),
          sql<number>`COALESCE(SUM(total_voids_cents), 0)`.as('global_voids_cents'),
          sql<number>`COALESCE(SUM(sales_count), 0)`.as('global_sales_count')
        ])
        .executeTakeFirst();

      let valuationQuery = app.db
        .selectFrom('inventory_valuation_snapshot')
        .where('tenant_id', '=', tenantId);

      const valuation = await valuationQuery
        .select(['total_value_cents', 'updated_at'])
        .orderBy('date', 'desc')
        .limit(1)
        .executeTakeFirst();

      // Branch Health (Open sessions, discrepancies)
      let openSessionsQuery = app.db
        .selectFrom('cash_sessions')
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'OPEN');

      if (request.auth!.role !== 'ADMIN') {
        openSessionsQuery = openSessionsQuery.where('branch_id', 'in', request.auth!.branchIds);
      }

      const openSessions = await openSessionsQuery
        .select([sql<number>`COUNT(*)`.as('open_sessions_count')])
        .executeTakeFirst();

      let closedSessionsTodayQuery = app.db
        .selectFrom('cash_sessions')
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'CLOSED')
        .where('closed_at', '>=', todayStart);

      if (request.auth!.role !== 'ADMIN') {
        closedSessionsTodayQuery = closedSessionsTodayQuery.where('branch_id', 'in', request.auth!.branchIds);
      }

      const closedSessionsToday = await closedSessionsTodayQuery
        .select([sql<number>`COALESCE(SUM(ABS(diff_cents)), 0)`.as('total_discrepancy_cents')])
        .executeTakeFirst();

      // Top Branches Today
      let topBranchesQuery = app.db
        .selectFrom('daily_branch_sales_rollup as r')
        .innerJoin('branches as b', 'b.id', 'r.branch_id')
        .where('r.tenant_id', '=', tenantId)
        .where('r.date', '=', todayStr as any);

      if (request.auth!.role !== 'ADMIN') {
        topBranchesQuery = topBranchesQuery.where('r.branch_id', 'in', request.auth!.branchIds);
      }

      const topBranches = await topBranchesQuery
        .select(['b.name', 'r.total_revenue_cents', 'r.sales_count'])
        .orderBy('r.total_revenue_cents', 'desc')
        .limit(3)
        .execute();

      return {
        kpis: {
          global_revenue_cents: Number(todaySales?.global_revenue_cents || 0),
          global_voids_cents: Number(todaySales?.global_voids_cents || 0),
          global_sales_count: Number(todaySales?.global_sales_count || 0),
          inventory_valuation_cents: Number(valuation?.total_value_cents || 0)
        },
        branch_health: {
          open_sessions_count: Number(openSessions?.open_sessions_count || 0),
          total_discrepancy_cents: Number(closedSessionsToday?.total_discrepancy_cents || 0)
        },
        top_branches: topBranches.map(b => ({
          name: b.name,
          revenue_cents: Number(b.total_revenue_cents),
          sales_count: b.sales_count
        }))
      };
    }
  );

  // Global Dashboard Stream Endpoint (SSE)
  typedApp.get(
    '/dashboard/global/stream',
    {
      preHandler: [app.requirePermissions(['dashboard:global:view'])], // Require ADMIN or global view
      schema: {
        tags: ['dashboard'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request, reply) => {
      if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'No autorizado');
      const { tenantId } = request.auth;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      const todayStr = new Date().toISOString().split('T')[0];
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const sendDashboardData = async () => {
        try {
          // Top-Level KPIs
          let todaySalesQuery = app.db
            .selectFrom('daily_branch_sales_rollup')
            .where('tenant_id', '=', tenantId)
            .where('date', '=', todayStr as any);

          if (request.auth!.role !== 'ADMIN') {
            todaySalesQuery = todaySalesQuery.where('branch_id', 'in', request.auth!.branchIds);
          }

          const todaySales = await todaySalesQuery
            .select([
              sql<number>`COALESCE(SUM(total_revenue_cents), 0)`.as('global_revenue_cents'),
              sql<number>`COALESCE(SUM(total_voids_cents), 0)`.as('global_voids_cents'),
              sql<number>`COALESCE(SUM(sales_count), 0)`.as('global_sales_count')
            ])
            .executeTakeFirst();

          let valuationQuery = app.db
            .selectFrom('inventory_valuation_snapshot')
            .where('tenant_id', '=', tenantId);

          const valuation = await valuationQuery
            .select(['total_value_cents', 'updated_at'])
            .orderBy('date', 'desc')
            .limit(1)
            .executeTakeFirst();

          // Branch Health (Open sessions, discrepancies)
          let openSessionsQuery = app.db
            .selectFrom('cash_sessions')
            .where('tenant_id', '=', tenantId)
            .where('status', '=', 'OPEN');

          if (request.auth!.role !== 'ADMIN') {
            openSessionsQuery = openSessionsQuery.where('branch_id', 'in', request.auth!.branchIds);
          }

          const openSessions = await openSessionsQuery
            .select([sql<number>`COUNT(*)`.as('open_sessions_count')])
            .executeTakeFirst();

          let closedSessionsTodayQuery = app.db
            .selectFrom('cash_sessions')
            .where('tenant_id', '=', tenantId)
            .where('status', '=', 'CLOSED')
            .where('closed_at', '>=', todayStart);

          if (request.auth!.role !== 'ADMIN') {
            closedSessionsTodayQuery = closedSessionsTodayQuery.where('branch_id', 'in', request.auth!.branchIds);
          }

          const closedSessionsToday = await closedSessionsTodayQuery
            .select([sql<number>`COALESCE(SUM(ABS(diff_cents)), 0)`.as('total_discrepancy_cents')])
            .executeTakeFirst();

          // Top Branches Today
          let topBranchesQuery = app.db
            .selectFrom('daily_branch_sales_rollup as r')
            .innerJoin('branches as b', 'b.id', 'r.branch_id')
            .where('r.tenant_id', '=', tenantId)
            .where('r.date', '=', todayStr as any);

          if (request.auth!.role !== 'ADMIN') {
            topBranchesQuery = topBranchesQuery.where('r.branch_id', 'in', request.auth!.branchIds);
          }

          const topBranches = await topBranchesQuery
            .select(['b.name', 'r.total_revenue_cents', 'r.sales_count'])
            .orderBy('r.total_revenue_cents', 'desc')
            .limit(3)
            .execute();

          const data = {
            kpis: {
              global_revenue_cents: Number(todaySales?.global_revenue_cents || 0),
              global_voids_cents: Number(todaySales?.global_voids_cents || 0),
              global_sales_count: Number(todaySales?.global_sales_count || 0),
              inventory_valuation_cents: Number(valuation?.total_value_cents || 0)
            },
            branch_health: {
              open_sessions_count: Number(openSessions?.open_sessions_count || 0),
              total_discrepancy_cents: Number(closedSessionsToday?.total_discrepancy_cents || 0)
            },
            top_branches: topBranches.map(b => ({
              name: b.name,
              revenue_cents: Number(b.total_revenue_cents),
              sales_count: b.sales_count
            }))
          };

          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
          console.error('Error generating dashboard stream data:', error);
        }
      };

      // Send immediately, then every 30 seconds
      await sendDashboardData();
      const interval = setInterval(sendDashboardData, 30000);

      request.raw.on('close', () => {
        clearInterval(interval);
      });
      
      // Prevent fastify from immediately resolving the handler
      await new Promise(() => {});
    }
  );

  // Tech Health Endpoint
  typedApp.get(
    '/dashboard/tech-health',
    {
      preHandler: [app.requirePermissions(['dashboard:global:view'])], // Assume ADMIN
      schema: {
        tags: ['dashboard'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'No autorizado');
      const { tenantId } = request.auth;

      // Outbox Status
      const outboxStats = await app.db
        .selectFrom('outbox_events')
        .where('tenant_id', '=', tenantId)
        .select([
          sql<number>`COUNT(CASE WHEN status = 'PENDING' THEN 1 END)`.as('pending_count'),
          sql<number>`COUNT(CASE WHEN status = 'FAILED' THEN 1 END)`.as('failed_count')
        ])
        .executeTakeFirst();

      return {
        outbox: {
          pending: Number(outboxStats?.pending_count || 0),
          failed: Number(outboxStats?.failed_count || 0),
          status: (Number(outboxStats?.failed_count || 0) > 0) ? 'DEGRADED' : 'HEALTHY'
        },
        worker: {
          status: 'HEALTHY' // In a real scenario, check heartbeat table
        }
      };
    }
  );
};
