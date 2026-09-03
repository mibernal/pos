import type { Kysely } from 'kysely';
import type { Database } from '../../../../shared/infra/db/schema.js';
import { monthlyRecurringCents, type RevenueMetrics } from '@pos-dian/shared';

/**
 * El panel de ingresos, sobre datos que ahora existen.
 *
 * `getSaasBillingMetrics` ya normalizaba el ciclo anual, pero solo podía hablar de lo que
 * *debería* entrar: precios de plan multiplicados por suscripciones. Lo cobrado de verdad
 * no estaba en ninguna parte, porque no había facturas. Con la 097 sí: `collected` sale de
 * facturas pagadas y `failed` de las que la cobranza no consiguió cerrar.
 *
 * El churn se mide sobre bajas efectivas de los últimos 30 días contra la base que había al
 * empezar la ventana —activas de hoy más las que se fueron—, que es la definición que
 * cualquiera espera al leer «churn» y no la que sale de dividir por la base final.
 */
export async function getRevenueMetrics(db: Kysely<Database>): Promise<RevenueMetrics> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const subs = await db
    .selectFrom('tenant_subscriptions as ts')
    .innerJoin('billing_plans as p', 'p.id', 'ts.plan_id')
    .select([
      'ts.status',
      'ts.plan_id',
      'ts.cancelled_at',
      'ts.created_at',
      'p.name as plan_name',
      'p.price_cents',
      'p.billing_cycle'
    ])
    .execute();

  let mrr = 0;
  let active = 0;
  let trial = 0;
  let pastDue = 0;
  let churned = 0;
  let created = 0;

  const byPlan = new Map<string, { plan_name: string; subscriptions: number; mrr_cents: number }>();

  for (const sub of subs) {
    const monthly = monthlyRecurringCents(sub.price_cents, sub.billing_cycle);

    if (sub.created_at >= windowStart) created += 1;

    switch (sub.status) {
      case 'ACTIVE': {
        active += 1;
        mrr += monthly;
        const row = byPlan.get(sub.plan_id) ?? { plan_name: sub.plan_name, subscriptions: 0, mrr_cents: 0 };
        row.subscriptions += 1;
        row.mrr_cents += monthly;
        byPlan.set(sub.plan_id, row);
        break;
      }
      case 'TRIAL':
        trial += 1;
        break;
      case 'PAST_DUE':
        pastDue += 1;
        break;
      case 'CANCELLED':
        if (sub.cancelled_at && sub.cancelled_at >= windowStart) churned += 1;
        break;
      default:
        break;
    }
  }

  const invoices = await db
    .selectFrom('subscription_invoices')
    .select(['status', 'total_cents', 'issued_at', 'paid_at'])
    .where('issued_at', '>=', windowStart)
    .execute();

  let collected = 0;
  let failed = 0;
  for (const invoice of invoices) {
    if (invoice.status === 'PAID') collected += invoice.total_cents;
    else if (invoice.status === 'OPEN' || invoice.status === 'UNCOLLECTIBLE') failed += invoice.total_cents;
  }

  // La base de la ventana: lo que sigue activo más lo que se fue en ella.
  const baseline = active + churned;

  return {
    mrr_cents: mrr,
    arr_cents: mrr * 12,
    arpa_cents: active > 0 ? Math.round(mrr / active) : 0,
    active_subscriptions: active,
    trial_subscriptions: trial,
    past_due_subscriptions: pastDue,
    churn_rate: baseline > 0 ? Number((churned / baseline).toFixed(4)) : 0,
    churned_last_30d: churned,
    new_last_30d: created,
    collected_last_30d_cents: collected,
    failed_last_30d_cents: failed,
    by_plan: [...byPlan.entries()]
      .map(([plan_id, row]) => ({ plan_id, ...row }))
      .sort((a, b) => b.mrr_cents - a.mrr_cents)
  };
}
