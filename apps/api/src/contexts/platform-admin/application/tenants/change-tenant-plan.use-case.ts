import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import { randomUUID } from 'crypto';
import { resolveBillingPlan, periodDaysForCycle } from '../billing-plans/resolve-plan.js';
import { LIVE_SUBSCRIPTION_STATUSES } from '../../../billing/application/subscription.service.js';

export class ChangeTenantPlanUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(tenantId: string, newPlan: string, actorId: string, actorEmail: string) {
    const tenant = await this.db.selectFrom('tenants').where('id', '=', tenantId).selectAll().executeTakeFirst();
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant no encontrado');

    const planRow = await resolveBillingPlan(this.db, newPlan);

    await this.db.transaction().execute(async (trx) => {
      // Antes solo se consideraba `ACTIVE`: a un comercio en prueba o en mora se le creaba
      // una segunda suscripción en vez de cambiarle el plan a la que ya tenía.
      const sub = await trx.selectFrom('tenant_subscriptions')
        .innerJoin('billing_plans', 'billing_plans.id', 'tenant_subscriptions.plan_id')
        .where('tenant_subscriptions.tenant_id', '=', tenantId)
        .where('tenant_subscriptions.status', 'in', LIVE_SUBSCRIPTION_STATUSES)
        .orderBy('tenant_subscriptions.created_at', 'desc')
        .select(['tenant_subscriptions.id', 'billing_plans.name as old_plan_name'])
        .executeTakeFirst();
      
      if (sub) {
        await trx.updateTable('tenant_subscriptions')
          .set({ plan_id: planRow.id })
          .where('id', '=', sub.id)
          .execute();
          
        await trx.insertInto('subscription_events').values({
          subscription_id: sub.id,
          type: 'PLAN_CHANGED',
          metadata: { old_plan: sub.old_plan_name, new_plan: planRow.id } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();

        await trx.insertInto('platform_events').values({
          tenant_id: tenantId,
          type: 'TENANT_PLAN_CHANGED',
          severity: 'INFO',
          actor_id: actorId,
          actor_email: actorEmail,
          metadata: { old_plan: sub.old_plan_name, new_plan: planRow.id } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();

      } else {
        const newSubId = randomUUID();
        const periodStart = new Date();
        const periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + periodDaysForCycle(planRow.billing_cycle));

        await trx.insertInto('tenant_subscriptions').values({
          id: newSubId,
          tenant_id: tenantId,
          plan_id: planRow.id,
          status: 'ACTIVE',
          current_period_start: periodStart,
          current_period_end: periodEnd,
          starts_at: periodStart,
          expires_at: periodEnd
        }).execute();
        
        await trx.insertInto('subscription_events').values({
          subscription_id: newSubId,
          type: 'PLAN_CREATED',
          metadata: { plan: planRow.id } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();

        await trx.insertInto('platform_events').values({
          tenant_id: tenantId,
          type: 'TENANT_PLAN_CHANGED',
          severity: 'INFO',
          actor_id: actorId,
          actor_email: actorEmail,
          metadata: { old_plan: null, new_plan: planRow.id } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();
      }
    });
  }
}
