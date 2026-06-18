import type { Kysely } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';

export interface SaasMetrics {
  mrr_cents: number;
  arr_cents: number;
  active_subscriptions: number;
  trial_subscriptions: number;
  past_due_subscriptions: number;
  suspended_subscriptions: number;
  cancelled_this_month: number;
  revenue_at_risk_cents: number;
  by_plan: Array<{
    plan_id: string;
    count: number;
    mrr_cents: number;
  }>;
}

export async function getSaasBillingMetrics(db: Kysely<Database>): Promise<SaasMetrics> {
  const result: SaasMetrics = {
    mrr_cents: 0,
    arr_cents: 0,
    active_subscriptions: 0,
    trial_subscriptions: 0,
    past_due_subscriptions: 0,
    suspended_subscriptions: 0,
    cancelled_this_month: 0,
    revenue_at_risk_cents: 0,
    by_plan: []
  };

  const subs = await db
    .selectFrom('tenant_subscriptions')
    .innerJoin('billing_plans', 'billing_plans.id', 'tenant_subscriptions.plan_id')
    .select([
      'tenant_subscriptions.status',
      'tenant_subscriptions.plan_id',
      'tenant_subscriptions.cancelled_at',
      'billing_plans.price_cents',
      'billing_plans.billing_cycle'
    ])
    .execute();

  const planStats = new Map<string, { count: number; mrr_cents: number }>();

  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  for (const sub of subs) {
    if (sub.status === 'TRIAL') result.trial_subscriptions++;
    else if (sub.status === 'ACTIVE') result.active_subscriptions++;
    else if (sub.status === 'PAST_DUE') result.past_due_subscriptions++;
    else if (sub.status === 'SUSPENDED') result.suspended_subscriptions++;
    
    if (sub.status === 'CANCELLED' && sub.cancelled_at && sub.cancelled_at >= firstDayOfMonth) {
      result.cancelled_this_month++;
    }

    if (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') {
      const isYearly = sub.billing_cycle === 'YEARLY';
      const monthlyPrice = isYearly ? Math.floor(sub.price_cents / 12) : sub.price_cents;
      
      if (sub.status === 'ACTIVE') {
        result.mrr_cents += monthlyPrice;
      } else {
        result.revenue_at_risk_cents += monthlyPrice;
      }

      if (sub.status === 'ACTIVE') {
        const stats = planStats.get(sub.plan_id) || { count: 0, mrr_cents: 0 };
        stats.count++;
        stats.mrr_cents += monthlyPrice;
        planStats.set(sub.plan_id, stats);
      }
    }
  }

  result.arr_cents = result.mrr_cents * 12;

  result.by_plan = Array.from(planStats.entries()).map(([plan_id, stats]) => ({
    plan_id,
    count: stats.count,
    mrr_cents: stats.mrr_cents
  }));

  return result;
}
