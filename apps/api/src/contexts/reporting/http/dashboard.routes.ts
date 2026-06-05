import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { ensureUserCanAccessBranch } from '../../../shared/infra/security/permissions.js';
import { setupSseStream } from '../../../shared/infra/security/sse-limits.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {


  // Use raw fastify route for SSE as it's easier to manage response streams
  app.get(
    '/dashboard/stream',
    {
      preHandler: [app.requirePermissions(['dashboard:view'])]
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

      try {
        ensureUserCanAccessBranch(request.auth, branch_id);
      } catch (err: any) {
        return reply.code(err.statusCode || 403).send({ message: err.message || 'No tienes acceso a esta sucursal' });
      }

      const stream = setupSseStream(request, reply);
      if (!stream) return;

      // Send initial data immediately

      const sendUpdate = async () => {
        if (!stream.isActive()) return;
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

          const inventoryRows = await app.db
            .selectFrom('inventory_balances')
            .innerJoin('products', 'products.id', 'inventory_balances.product_id')
            .where('inventory_balances.tenant_id', '=', tenantId)
            .where('inventory_balances.branch_id', '=', branch_id)
            .select([
              sql<number>`COALESCE(SUM(inventory_balances.on_hand_qty * products.cost_cents), 0)`.as('total_inventory_value_cents')
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

          const responsePayload = {
            total_revenue_cents: Number(rows?.total_revenue_cents || 0),
            total_sales_count: Number(rows?.total_sales_count || 0),
            total_inventory_value_cents: Number(inventoryRows?.total_inventory_value_cents || 0),
            chart_data: chartData
          };

          const payload = JSON.stringify(responsePayload);
          stream.writeEvent(payload);
        } catch (err) {
          app.log.error(err, 'SSE Push error');
        }
      };

      // Push initial
      sendUpdate();

      // En un entorno de producción, esto debería usar PostgreSQL LISTEN/NOTIFY o Redis Pub/Sub
      // para suscribirse a eventos 'sale_completed', 'session_closed', etc., en lugar de polling.
      const interval = setInterval(sendUpdate, 5000);

      request.raw.on('close', () => {
        clearInterval(interval);
      });
    }
  );
};
