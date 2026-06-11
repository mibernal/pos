import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import { CreatePlanCommand } from '../../domain/platform-admin.types.js';

export class CreatePlanUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(payload: CreatePlanCommand, actorId: string, actorEmail: string) {
    const existing = await this.db.selectFrom('billing_plans').where('id', '=', payload.id).select('id').executeTakeFirst();
    if (existing) throw new AppError(400, 'BAD_REQUEST', 'El ID del plan ya existe');

    await this.db.insertInto('billing_plans').values({
      id: payload.id,
      name: payload.name,
      price_cents: payload.price_cents,
      billing_cycle: payload.billing_cycle,
      features_json: payload.features_json as any,
    }).execute();

    await this.db.insertInto('platform_events').values({
      tenant_id: null,
      type: 'PLAN_CREATED',
      severity: 'INFO',
      actor_id: actorId,
      actor_email: actorEmail,
      metadata: payload as any // eslint-disable-line @typescript-eslint/no-explicit-any
    }).execute();

    return payload.id;
  }
}
