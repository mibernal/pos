import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import { randomUUID } from 'crypto';

export class ChangeTenantPlanUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(tenantId: string, newPlan: string, actorId: string, actorEmail: string) {
    const tenant = await this.db.selectFrom('tenants').where('id', '=', tenantId).selectAll().executeTakeFirst();
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant no encontrado');

    const planRow = await this.db.selectFrom('billing_plans').where('name', '=', newPlan).selectAll().executeTakeFirst();
    if (!planRow) throw new AppError(400, 'BAD_REQUEST', 'Plan inválido');

    await this.db.transaction().execute(async (trx) => {
      const sub = await trx.selectFrom('tenant_subscriptions')
        .innerJoin('billing_plans', 'billing_plans.id', 'tenant_subscriptions.plan_id')
        .where('tenant_subscriptions.tenant_id', '=', tenantId)
        .where('tenant_subscriptions.status', '=', 'ACTIVE')
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
          metadata: { old_plan: sub.old_plan_name, new_plan: newPlan } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();

        await trx.insertInto('platform_events').values({
          tenant_id: tenantId,
          type: 'TENANT_PLAN_CHANGED',
          severity: 'INFO',
          actor_id: actorId,
          actor_email: actorEmail,
          metadata: { old_plan: sub.old_plan_name, new_plan: newPlan } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();

      } else {
        const newSubId = randomUUID();
        await trx.insertInto('tenant_subscriptions').values({
          id: newSubId,
          tenant_id: tenantId,
          plan_id: planRow.id,
          status: 'ACTIVE',
          current_period_start: new Date(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          starts_at: new Date(),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }).execute();
        
        await trx.insertInto('subscription_events').values({
          subscription_id: newSubId,
          type: 'PLAN_CREATED',
          metadata: { plan: newPlan } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();

        await trx.insertInto('platform_events').values({
          tenant_id: tenantId,
          type: 'TENANT_PLAN_CHANGED',
          severity: 'INFO',
          actor_id: actorId,
          actor_email: actorEmail,
          metadata: { old_plan: null, new_plan: newPlan } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();
      }
    });
  }
}
