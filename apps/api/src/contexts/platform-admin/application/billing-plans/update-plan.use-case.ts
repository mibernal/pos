import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import { UpdatePlanCommand } from '../../domain/platform-admin.types.js';

export class UpdatePlanUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(planId: string, payload: UpdatePlanCommand, actorId: string, actorEmail: string) {
    const plan = await this.db.selectFrom('billing_plans').where('id', '=', planId).selectAll().executeTakeFirst();
    if (!plan) throw new AppError(404, 'NOT_FOUND', 'Plan no encontrado');

    const updateData: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (payload.name !== undefined) updateData.name = payload.name;
    if (payload.price_cents !== undefined) updateData.price_cents = payload.price_cents;
    if (payload.billing_cycle !== undefined) updateData.billing_cycle = payload.billing_cycle;
    if (payload.features_json !== undefined) updateData.features_json = payload.features_json;
    if (payload.active !== undefined) updateData.active = payload.active;
    if (payload.metadata_json !== undefined) updateData.metadata_json = payload.metadata_json;

    if (Object.keys(updateData).length > 0) {
      await this.db.updateTable('billing_plans')
        .set(updateData)
        .where('id', '=', planId)
        .execute();
    }

    await this.db.insertInto('platform_events').values({
      tenant_id: null,
      type: 'PLAN_UPDATED',
      severity: 'INFO',
      actor_id: actorId,
      actor_email: actorEmail,
      metadata: payload as any // eslint-disable-line @typescript-eslint/no-explicit-any
    }).execute();
  }
}
