import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import type { Redis } from 'ioredis';
import { invalidateDashboardCache } from '../../../shared/infra/cache/invalidate-dashboard-cache.js';

export type DbClient = Kysely<Database> | Transaction<Database>;

/**
 * Estados de una suscripción que sigue en juego. Una `CANCELLED` es histórico: no se
 * renueva, no se activa y no se cuenta como la suscripción del comercio.
 *
 * Todas las lecturas por comercio filtran por esto y ordenan por `created_at`. Sin las dos
 * cosas, `executeTakeFirst()` devolvía una fila arbitraria en cuanto un comercio tenía más
 * de una — y el `plan_id` que se firma en el JWT podía cambiar entre dos logins seguidos.
 * La migración 091 añade además el índice único que impide que lleguen a coexistir.
 */
export const LIVE_SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'] as const;

export class SubscriptionService {
  /**
   * Crea una suscripción inicial (generalmente TRIAL)
   */
  static async createSubscription(
    db: DbClient,
    tenantId: string,
    planId: string = 'STARTER',
    status: string = 'TRIAL',
    durationDays: number = 14,
    autoRenew: boolean = false,
    redis?: Redis
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
      auto_renew: autoRenew,
      created_at: new Date(),
      updated_at: new Date()
    }).execute();
    if (redis) {
      await invalidateDashboardCache(redis);
    }

    return subscriptionId;
  }

  /**
   * Activa una suscripción tras el primer pago aprobado
   */
  static async activateSubscription(db: DbClient, tenantId: string, durationDays: number = 30, redis?: Redis) {
    const currentSub = await db.selectFrom('tenant_subscriptions')
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', LIVE_SUBSCRIPTION_STATUSES)
      .orderBy('created_at', 'desc')
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

    if (redis) {
      await invalidateDashboardCache(redis);
    }
  }

  /**
   * Renueva una suscripción existente
   */
  static async renewSubscription(db: DbClient, tenantId: string, durationDays: number = 30, redis?: Redis) {
    const currentSub = await db.selectFrom('tenant_subscriptions')
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', LIVE_SUBSCRIPTION_STATUSES)
      .orderBy('created_at', 'desc')
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

    if (redis) {
      await invalidateDashboardCache(redis);
    }
  }

  /**
   * Actualiza el plan de una suscripción
   */
  static async upgradeSubscription(db: DbClient, tenantId: string, newPlanId: string, redis?: Redis) {
    const currentSub = await db.selectFrom('tenant_subscriptions')
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', LIVE_SUBSCRIPTION_STATUSES)
      .orderBy('created_at', 'desc')
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

    if (redis) {
      await invalidateDashboardCache(redis);
    }
  }

  /**
   * Cancela una suscripción
   */
  static async cancelSubscription(db: DbClient, tenantId: string, redis?: Redis) {
    const currentSub = await db.selectFrom('tenant_subscriptions')
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', LIVE_SUBSCRIPTION_STATUSES)
      .orderBy('created_at', 'desc')
      .select('id')
      .executeTakeFirst();

    if (!currentSub) return;

    // `CANCELLED`, con dos eles. Aquí se escribía `CANCELED` mientras el tipo
    // `SubscriptionStatus` y `billing-metrics` consultaban la otra forma: las bajas
    // existían en la tabla y no las contaba nadie. La migración 091 normaliza el
    // histórico y añade el CHECK que impide que vuelva a ocurrir.
    await db.updateTable('tenant_subscriptions')
      .set({
        status: 'CANCELLED',
        cancelled_at: new Date(),
        updated_at: new Date()
      })
      .where('id', '=', currentSub.id)
      .execute();
      
    await db.insertInto('subscription_events').values({
      subscription_id: currentSub.id,
      type: 'CANCELLED',
      metadata: { reason: 'User requested cancellation' }
    }).execute();

    if (redis) {
      await invalidateDashboardCache(redis);
    }
  }

  /**
   * Marca una suscripción como vencida (PAST_DUE)
   */
  static async markPastDue(db: DbClient, subscriptionId: string, redis?: Redis) {
    await db.updateTable('tenant_subscriptions')
      .set({
        status: 'PAST_DUE',
        updated_at: new Date()
      })
      .where('id', '=', subscriptionId)
      .execute();
      
    await db.insertInto('subscription_events').values({
      subscription_id: subscriptionId,
      type: 'PAST_DUE',
      metadata: { reason: 'Payment failed or trial expired' }
    }).execute();

    if (redis) {
      await invalidateDashboardCache(redis);
    }
  }

  /**
   * Suspende una suscripción por falta de pago
   */
  static async suspendSubscription(db: DbClient, subscriptionId: string, reason: string, redis?: Redis) {
    await db.updateTable('tenant_subscriptions')
      .set({
        status: 'SUSPENDED',
        suspended_at: new Date(),
        updated_at: new Date()
      })
      .where('id', '=', subscriptionId)
      .execute();
      
    await db.insertInto('subscription_events').values({
      subscription_id: subscriptionId,
      type: 'SUSPENDED',
      metadata: { reason }
    }).execute();

    if (redis) {
      await invalidateDashboardCache(redis);
    }
  }

  /**
   * Reactiva una suscripción previamente suspendida
   */
  static async reactivateSubscription(db: DbClient, subscriptionId: string, redis?: Redis) {
    await db.updateTable('tenant_subscriptions')
      .set({
        status: 'ACTIVE',
        suspended_at: null,
        updated_at: new Date()
      })
      .where('id', '=', subscriptionId)
      .execute();
      
    await db.insertInto('subscription_events').values({
      subscription_id: subscriptionId,
      type: 'REACTIVATED',
      metadata: { reason: 'Manual reactivation or late payment received' }
    }).execute();

    if (redis) {
      await invalidateDashboardCache(redis);
    }
  }

  /**
   * Programa la próxima fecha de cobro para una suscripción
   */
  static async scheduleNextBilling(db: DbClient, subscriptionId: string, daysUntilNextBilling: number, redis?: Redis) {
    const nextBillingAt = new Date();
    nextBillingAt.setDate(nextBillingAt.getDate() + daysUntilNextBilling);

    await db.updateTable('tenant_subscriptions')
      .set({
        next_billing_at: nextBillingAt,
        retry_count: 0, // Reiniciamos los intentos
        updated_at: new Date()
      })
      .where('id', '=', subscriptionId)
      .execute();

    if (redis) {
      await invalidateDashboardCache(redis);
    }
  }
}
