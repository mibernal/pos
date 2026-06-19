import { Kysely, sql } from 'kysely';
import { Database } from '../../../shared/infra/db/schema.js';

export class PlatformAdminRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async getDashboardMetrics() {
    const tenantsCount = await this.db.selectFrom('tenants')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .executeTakeFirst();
      
    const activeTenantsCount = await this.db.selectFrom('tenants')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
      
    const usersCount = await this.db.selectFrom('users')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('active', '=', true)
      .executeTakeFirst();

    // calculate MRR & ARR from active subscriptions
    const mrrQuery = await this.db.selectFrom('tenant_subscriptions as ts')
      .innerJoin('billing_plans as bp', 'bp.id', 'ts.plan_id')
      .where('ts.status', '=', 'ACTIVE')
      .select(({ fn }) => fn.sum<number>('bp.price_cents').as('mrr_cents'))
      .executeTakeFirst();

    const mrrCents = Number(mrrQuery?.mrr_cents || 0);
    const arrCents = mrrCents * 12;

    const trialsCount = await this.db.selectFrom('tenant_subscriptions')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('status', '=', 'TRIALING')
      .executeTakeFirst();

    const next30Days = new Date();
    next30Days.setDate(next30Days.getDate() + 30);
    
    const expiringSoon = await this.db.selectFrom('tenant_subscriptions')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('status', '=', 'ACTIVE')
      .where('expires_at', '<', next30Days)
      .executeTakeFirst();

    const suspendedCount = await this.db.selectFrom('tenants')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('status', '=', 'SUSPENDED')
      .executeTakeFirst();

    return {
      totalTenants: Number(tenantsCount?.count || 0),
      activeTenants: Number(activeTenantsCount?.count || 0),
      totalUsers: Number(usersCount?.count || 0),
      mrrCents,
      arrCents,
      activeTrials: Number(trialsCount?.count || 0),
      expiringSubscriptions: Number(expiringSoon?.count || 0),
      suspendedTenants: Number(suspendedCount?.count || 0)
    };
  }

  async getGrowthMetrics() {
    const tenantsByMonth = await this.db
      .selectFrom('tenants')
      .select(({ fn }) => [
        sql<string>`to_char(date_trunc('month', created_at), 'Mon YYYY')`.as('month'),
        fn.count<number>('id').as('tenants')
      ])
      .groupBy(sql`date_trunc('month', created_at)`)
      .orderBy(sql`date_trunc('month', created_at)`)
      .execute();

    const usersByMonth = await this.db
      .selectFrom('users')
      .select(({ fn }) => [
        sql<string>`to_char(date_trunc('month', created_at), 'Mon YYYY')`.as('month'),
        fn.count<number>('id').as('users')
      ])
      .groupBy(sql`date_trunc('month', created_at)`)
      .orderBy(sql`date_trunc('month', created_at)`)
      .execute();

    // Map by month
    const historyMap = new Map<string, { month: string; tenants: number; users: number; revenueCents: number }>();
    
    for (const t of tenantsByMonth) {
      historyMap.set(t.month, { month: t.month, tenants: Number(t.tenants), users: 0, revenueCents: 0 });
    }
    
    for (const u of usersByMonth) {
      if (!historyMap.has(u.month)) {
        historyMap.set(u.month, { month: u.month, tenants: 0, users: Number(u.users), revenueCents: 0 });
      } else {
        historyMap.get(u.month)!.users = Number(u.users);
      }
    }

    return Array.from(historyMap.values());
  }

  async getRecentActivity(limit = 50) {
    return await this.db.selectFrom('platform_events')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  }

  async searchTenants(opts: {
    query?: string;
    status?: string;
    plan?: string;
    activity?: string;
    limit: number;
    offset: number;
  }) {
    let q = this.db.selectFrom('tenants as t')
      .leftJoin('users as u', 'u.id', 't.owner_user_id')
      .leftJoin('tenant_subscriptions as ts', 'ts.tenant_id', 't.id')
      .leftJoin('billing_plans as bp', 'bp.id', 'ts.plan_id')
      .select([
        't.id', 't.name', 't.business_name', 't.nit as document_number',
        't.status', 't.created_at', 't.business_type',
        'bp.name as plan_name', 'bp.price_cents as plan_price_cents',
        'ts.status as subscription_status', 'ts.expires_at',
        'u.email as owner_email'
      ]);

    if (opts.query) {
      const qs = `%${opts.query}%`;
      q = q.where((eb) => eb.or([
        eb('t.name', 'ilike', qs),
        eb('t.business_name', 'ilike', qs),
        eb('t.nit', 'ilike', qs),
        eb('u.email', 'ilike', qs)
      ]));
    }

    if (opts.status && opts.status !== 'ALL') {
      q = q.where('t.status', '=', opts.status);
    }
    
    if (opts.plan && opts.plan !== 'ALL') {
      q = q.where('bp.id', '=', opts.plan);
    }

    const items = await q
      .orderBy('t.created_at', 'desc')
      .limit(opts.limit)
      .offset(opts.offset)
      .execute();

    const countQuery = await q.clearSelect().select(({ fn }) => fn.count<number>('t.id').as('total')).executeTakeFirst();

    return {
      items,
      total: Number(countQuery?.total || 0)
    };
  }
}
