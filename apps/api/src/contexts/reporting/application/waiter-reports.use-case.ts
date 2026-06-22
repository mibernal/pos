import { Kysely, sql } from 'kysely';
import { Database } from '../../../shared/infra/db/schema.js';
import { WaiterReportQuery, WaitersReportResponse } from '@pos-dian/shared';

export class WaiterReportsUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(tenantId: string, query: WaiterReportQuery): Promise<WaitersReportResponse> {
    let queryBuilder = this.db
      .selectFrom('sales')
      .leftJoin('users', 'users.id', 'sales.waiter_id')
      .where('sales.tenant_id', '=', tenantId)
      .where('sales.branch_id', '=', query.branch_id)
      .where('sales.status', '=', 'COMPLETED');

    if (query.from) {
      queryBuilder = queryBuilder.where('sales.created_at', '>=', new Date(query.from));
    }

    if (query.to) {
      queryBuilder = queryBuilder.where('sales.created_at', '<=', new Date(query.to));
    }

    const rows = await queryBuilder
      .select([
        'sales.waiter_id',
        'users.name as waiter_name',
        sql<number>`SUM(sales.total_cents)`.as('total_revenue_cents'),
        sql<number>`COUNT(sales.id)`.as('total_sales_count'),
        sql<number>`SUM(COALESCE(sales.tip_cents, 0))`.as('total_tips_cents')
      ])
      .groupBy(['sales.waiter_id', 'users.name'])
      .orderBy('total_revenue_cents', 'desc')
      .execute();

    const items = rows.map((r) => {
      const rev = Number(r.total_revenue_cents || 0);
      const count = Number(r.total_sales_count || 0);
      const tips = Number(r.total_tips_cents || 0);
      
      return {
        waiter_id: r.waiter_id,
        waiter_name: r.waiter_name || 'Sin Mesero Asignado',
        total_revenue_cents: rev,
        total_sales_count: count,
        total_tips_cents: tips,
        average_ticket_cents: count > 0 ? Math.round(rev / count) : 0
      };
    });

    return { items };
  }
}
