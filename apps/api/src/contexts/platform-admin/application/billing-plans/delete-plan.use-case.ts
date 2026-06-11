import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';

export class DeletePlanUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(planId: string, actorId: string, actorEmail: string) {
    const plan = await this.db.selectFrom('billing_plans').where('id', '=', planId).selectAll().executeTakeFirst();
    if (!plan) throw new AppError(404, 'NOT_FOUND', 'Plan no encontrado');

    await this.db.updateTable('billing_plans')
      .set({ 
        active: false, 
        archived_at: new Date() 
      })
      .where('id', '=', planId)
      .execute();

    await this.db.insertInto('platform_events').values({
      tenant_id: null,
      type: 'PLAN_ARCHIVED',
      severity: 'WARNING',
      actor_id: actorId,
      actor_email: actorEmail,
      metadata: { plan_id: planId } as any // eslint-disable-line @typescript-eslint/no-explicit-any
    }).execute();
  }
}
