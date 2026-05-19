import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
export const dashboardRoutes: FastifyPluginAsync = async (app) => {


  // Use raw fastify route for SSE as it's easier to manage response streams
  app.get(
    '/dashboard/stream',
    {
      preHandler: [app.requireRoles(['ADMIN', 'MANAGER'])]
    },
    (request, reply) => {
      if (!request.auth) {
        return reply.code(401).send({ message: 'No autorizado' });
      }

      const { tenantId } = request.auth;
      const { branch_id } = request.query as Record<string, string | undefined>;

      if (!branch_id) {
        return reply.code(400).send({ message: 'branch_id es requerido' });
      }

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders();

      // Send initial data immediately
      let active = true;

      const pushData = async () => {
        if (!active) return;
        try {
          // Calculate today's stats
          const startOfDay = new Date();
          startOfDay.setHours(0, 0, 0, 0);

          const endOfDay = new Date();
          endOfDay.setHours(23, 59, 59, 999);

          const rows = await app.db
            .selectFrom('sales')
            .where('tenant_id', '=', tenantId)
            .where('branch_id', '=', branch_id)
            .where('status', '=', 'COMPLETED')
            .where('created_at', '>=', startOfDay)
            .where('created_at', '<=', endOfDay)
            .select([
              sql<number>`COALESCE(SUM(total_cents), 0)`.as('total_revenue_cents'),
              sql<number>`COUNT(*)`.as('total_sales_count')
            ])
            .executeTakeFirst();

          // Recent sales for a timeline
          const recentSales = await app.db
            .selectFrom('sales')
            .where('tenant_id', '=', tenantId)
            .where('branch_id', '=', branch_id)
            .where('status', '=', 'COMPLETED')
            .where('created_at', '>=', startOfDay)
            .select(['created_at', 'total_cents'])
            .orderBy('created_at', 'asc')
            .execute();

          // Group by hour for chart
          const hourlyChart = new Array(24).fill(0);
          recentSales.forEach(sale => {
            const hour = new Date(sale.created_at).getHours();
            hourlyChart[hour] += sale.total_cents;
          });

          const chartData = hourlyChart.map((amount, hour) => ({
            hour: `${hour}:00`,
            amount_cents: amount
          })).filter(d => d.amount_cents > 0);

          const payload = {
            total_revenue_cents: Number(rows?.total_revenue_cents || 0),
            total_sales_count: Number(rows?.total_sales_count || 0),
            chart_data: chartData
          };

          reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch (err) {
          app.log.error(err, 'SSE Push error');
        }
      };

      // Push initial
      void pushData();

      // Push every 15 seconds
      const interval = setInterval(() => {
        void pushData();
      }, 15000);

      request.raw.on('close', () => {
        active = false;
        clearInterval(interval);
      });
    }
  );
};
