import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../shared/infra/errors/app-error.js';

export type DbClient = Kysely<Database> | Transaction<Database>;

export class SubscriptionService {
  /**
   * Crea una suscripción inicial (generalmente TRIAL)
   */
  static async createSubscription(
    db: DbClient,
    tenantId: string,
    planId: string = 'STARTER',
    status: string = 'TRIAL',
    durationDays: number = 14
  ) {
    const startsAt = new Date();
    const expiresAt = new Date();
    expiresAt.setDate(startsAt.getDate() + durationDays);

    const subscriptionId = randomUUID();

    await db.insertInto('tenant_subscriptions').values({
      id: subscriptionId,
      tenant_id: tenantId,
      plan_id: planId,
      status: status,
      current_period_start: startsAt,
      current_period_end: expiresAt,
      starts_at: startsAt,
      trial_ends_at: status === 'TRIAL' ? expiresAt : null,
      expires_at: expiresAt,
      created_at: new Date(),
      updated_at: new Date()
    }).execute();

    return subscriptionId;
  }

  /**
   * Activa una suscripción tras el primer pago aprobado
   */
  static async activateSubscription(db: DbClient, tenantId: string, durationDays: number = 30) {
    const currentSub = await db.selectFrom('tenant_subscriptions')
      .where('tenant_id', '=', tenantId)
      .select(['id', 'plan_id'])
      .executeTakeFirst();

    if (!currentSub) {
      throw new AppError(404, 'NOT_FOUND', 'El tenant no tiene una suscripción base');
    }

    const startsAt = new Date();
    const expiresAt = new Date();
    expiresAt.setDate(startsAt.getDate() + durationDays);

    await db.updateTable('tenant_subscriptions')
      .set({
        status: 'ACTIVE',
        current_period_start: startsAt,
        current_period_end: expiresAt,
        expires_at: expiresAt,
        updated_at: new Date()
      })
      .where('id', '=', currentSub.id)
      .execute();

    await db.insertInto('subscription_events').values({
      subscription_id: currentSub.id,
      type: 'ACTIVATED',
      metadata: { reason: 'Initial payment approved' }
    }).execute();
  }

  /**
   * Renueva una suscripción existente
   */
  static async renewSubscription(db: DbClient, tenantId: string, durationDays: number = 30) {
    const currentSub = await db.selectFrom('tenant_subscriptions')
      .where('tenant_id', '=', tenantId)
      .select(['id', 'current_period_end', 'status'])
      .executeTakeFirst();

    if (!currentSub) {
      throw new AppError(404, 'NOT_FOUND', 'Suscripción no encontrada');
    }

    // Si ya estaba vencida, empezamos desde hoy, sino, le sumamos al periodo final
    const baseDate = currentSub.current_period_end && currentSub.current_period_end > new Date()
      ? new Date(currentSub.current_period_end)
      : new Date();

    const newEnd = new Date(baseDate);
    newEnd.setDate(newEnd.getDate() + durationDays);

    await db.updateTable('tenant_subscriptions')
      .set({
        status: 'ACTIVE', // Reactiva si estaba vencida
        current_period_end: newEnd,
        expires_at: newEnd,
        updated_at: new Date()
      })
      .where('id', '=', currentSub.id)
      .execute();
      
    await db.insertInto('subscription_events').values({
      subscription_id: currentSub.id,
      type: 'RENEWED',
      metadata: { daysAdded: durationDays }
    }).execute();
  }

  /**
   * Actualiza el plan de una suscripción
   */
  static async upgradeSubscription(db: DbClient, tenantId: string, newPlanId: string) {
    const currentSub = await db.selectFrom('tenant_subscriptions')
      .where('tenant_id', '=', tenantId)
      .select(['id', 'plan_id'])
      .executeTakeFirst();

    if (!currentSub) {
      throw new AppError(404, 'NOT_FOUND', 'Suscripción no encontrada');
    }

    await db.updateTable('tenant_subscriptions')
      .set({
        plan_id: newPlanId,
        updated_at: new Date()
      })
      .where('id', '=', currentSub.id)
      .execute();
      
    await db.insertInto('subscription_events').values({
      subscription_id: currentSub.id,
      type: 'PLAN_CHANGED',
      metadata: { oldPlan: currentSub.plan_id, newPlan: newPlanId }
    }).execute();
  }

  /**
   * Cancela una suscripción
   */
  static async cancelSubscription(db: DbClient, tenantId: string) {
    const currentSub = await db.selectFrom('tenant_subscriptions')
      .where('tenant_id', '=', tenantId)
      .select('id')
      .executeTakeFirst();

    if (!currentSub) return;

    await db.updateTable('tenant_subscriptions')
      .set({
        status: 'CANCELED',
        updated_at: new Date()
      })
      .where('id', '=', currentSub.id)
      .execute();
      
    await db.insertInto('subscription_events').values({
      subscription_id: currentSub.id,
      type: 'CANCELED',
      metadata: { reason: 'User requested cancellation' }
    }).execute();
  }
}
