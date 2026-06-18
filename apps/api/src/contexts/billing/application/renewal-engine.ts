import type { Kysely } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import { SubscriptionService } from './subscription.service.js';
import { env } from '../../../app/env.js';
import { NotificationService } from '../../../shared/infra/notifications/NotificationService.js';
import { TracerHelper } from '../../../shared/infra/tracing/Tracer.js';

export class RenewalEngine {
  /**
   * Procesa suscripciones en TRIAL que ya expiraron.
   * Si tienen auto_renew = true y método de pago, intenta cobrar.
   * Si no, las pasa a PAST_DUE o CANCELLED dependiendo de la lógica de negocio.
   */
  static async processTrialExpirations(db: Kysely<Database>) {
    const expiredTrials = await db.transaction().execute(async (trx) => {
      return trx
        .selectFrom('tenant_subscriptions')
        .select(['id', 'tenant_id', 'auto_renew', 'payment_method_token', 'plan_id'])
        .where('status', '=', 'TRIAL')
        .where('trial_ends_at', '<=', new Date())
        .limit(100)
        .forUpdate()
        .skipLocked()
        .execute();
    });

    for (const sub of expiredTrials) {
      await db.transaction().execute(async (trx) => {
        // En MVP, si no hay auto_renew, la pasamos a PAST_DUE para dar grace period
        // O si preferimos, directo a CANCELLED si trial expira sin payment method
        await SubscriptionService.markPastDue(trx, sub.id);
        
        // TODO: Si auto_renew es true, intentar cobrar el primer mes
      });
    }
    
    return expiredTrials.length;
  }

  /**
   * Notifica a los tenants cuya suscripción (TRIAL o ACTIVE) expira en 3 días.
   */
  static async processUpcomingExpirations(db: Kysely<Database>) {
    const targetDateStart = new Date();
    targetDateStart.setDate(targetDateStart.getDate() + 3);
    targetDateStart.setHours(0, 0, 0, 0);

    const targetDateEnd = new Date(targetDateStart);
    targetDateEnd.setHours(23, 59, 59, 999);

    const upcoming = await db.selectFrom('tenant_subscriptions as ts')
      .innerJoin('tenants as t', 't.id', 'ts.tenant_id')
      .select(['ts.id', 'ts.tenant_id', 'ts.plan_id', 'ts.status', 'ts.trial_ends_at', 'ts.current_period_end', 't.name as tenant_name'])
      .where('ts.status', 'in', ['TRIAL', 'ACTIVE'])
      .where((eb) => eb.or([
        eb.and([
          eb('ts.status', '=', 'TRIAL'),
          eb('ts.trial_ends_at', '>=', targetDateStart),
          eb('ts.trial_ends_at', '<=', targetDateEnd)
        ]),
        eb.and([
          eb('ts.status', '=', 'ACTIVE'),
          eb('ts.current_period_end', '>=', targetDateStart),
          eb('ts.current_period_end', '<=', targetDateEnd)
        ])
      ]))
      .execute();

    const notificationService = new NotificationService(db);

    for (const sub of upcoming) {
      const expDate = sub.status === 'TRIAL' ? sub.trial_ends_at : sub.current_period_end;
      if (!expDate) continue;

      await notificationService.notifySubscriptionExpiring(sub.tenant_id, {
        tenantName: sub.tenant_name,
        planName: sub.plan_id,
        daysRemaining: 3,
        expirationDate: expDate.toLocaleDateString()
      });
    }

    return upcoming.length;
  }

  /**
   * Busca suscripciones ACTIVE que deben renovarse hoy.
   */
  static async processRenewals(db: Kysely<Database>) {
    const renewals = await db.transaction().execute(async (trx) => {
      return trx
        .selectFrom('tenant_subscriptions')
        .select(['id', 'tenant_id', 'auto_renew', 'payment_method_token', 'plan_id'])
        .where('status', '=', 'ACTIVE')
        .where('next_billing_at', '<=', new Date())
        .limit(100)
        .forUpdate()
        .skipLocked()
        .execute();
    });

    for (const sub of renewals) {
      await db.transaction().execute(async (trx) => {
        if (sub.auto_renew && sub.payment_method_token) {
          // Intentar cobrar
          // Si falla, markPastDue y aumentar retry_count
          // MVP mock:
          // await chargeMethod(...)
          // if (failed) await SubscriptionService.markPastDue(trx, sub.id);
        } else {
          // Si no tiene auto_renew o no hay token, enviar email de cobro manual
          // Y mover a PAST_DUE para iniciar el grace period
          await SubscriptionService.markPastDue(trx, sub.id);
          
          await trx.insertInto('subscription_events').values({
            subscription_id: sub.id,
            type: 'RENEWAL_FAILED',
            metadata: { reason: 'No auto-renew enabled, marked as past due' }
          }).execute();
        }
      });
    }

    return renewals.length;
  }

  /**
   * Reintenta cobrar suscripciones PAST_DUE (si tienen auto_renew).
   */
  static async processRetries(db: Kysely<Database>) {
    // Buscamos PAST_DUE con auto_renew
    const retries = await db.transaction().execute(async (trx) => {
      return trx
        .selectFrom('tenant_subscriptions')
        .select(['id', 'tenant_id', 'retry_count', 'max_retries', 'auto_renew'])
        .where('status', '=', 'PAST_DUE')
        .where('auto_renew', '=', true)
        // Lógica de backoff: last_payment_attempt_at + horas
        // .where('last_payment_attempt_at', '<=', backoff_date)
        .limit(100)
        .forUpdate()
        .skipLocked()
        .execute();
    });

    for (const sub of retries) {
      if (sub.retry_count >= sub.max_retries) {
        continue; // Agotó reintentos, el procesador de suspensiones se encargará
      }
      
      // await chargeMethod()
      // update retry_count++
    }
    
    return retries.length;
  }

  /**
   * Suspende suscripciones PAST_DUE que agotaron su grace period.
   */
  static async processSuspensions(db: Kysely<Database>) {
    const gracePeriodThreshold = new Date();
    gracePeriodThreshold.setDate(gracePeriodThreshold.getDate() - env.BILLING_GRACE_PERIOD_DAYS);

    const toSuspend = await db.transaction().execute(async (trx) => {
      // Usamos el updated_at o un log para saber cuándo entró a PAST_DUE.
      // Para simplificar en este MVP, usamos last_payment_attempt_at o asumimos current_period_end
      return trx
        .selectFrom('tenant_subscriptions')
        .select(['id', 'tenant_id', 'current_period_end'])
        .where('status', '=', 'PAST_DUE')
        .where('current_period_end', '<=', gracePeriodThreshold)
        .limit(100)
        .forUpdate()
        .skipLocked()
        .execute();
    });

    for (const sub of toSuspend) {
      await db.transaction().execute(async (trx) => {
        await SubscriptionService.suspendSubscription(trx, sub.id, 'Grace period expired');
        await trx.updateTable('tenants')
          .set({ status: 'SUSPENDED' })
          .where('id', '=', sub.tenant_id)
          .execute();
      });
    }

    return toSuspend.length;
  }

  /**
   * Ejecuta todo el flujo
   */
  static async runAll(db: Kysely<Database>) {
    return TracerHelper.withSpan('billing', 'billing.renewal.run_all', {}, async (span) => {
      const results = {
        trials: await TracerHelper.withSpan('billing', 'billing.renewal.trial_expirations', {}, async (childSpan) => {
          const count = await this.processTrialExpirations(db);
          childSpan.setAttribute('processed_count', count);
          return count;
        }),
        upcoming: await TracerHelper.withSpan('billing', 'billing.renewal.upcoming_expirations', {}, async (childSpan) => {
          const count = await this.processUpcomingExpirations(db);
          childSpan.setAttribute('processed_count', count);
          return count;
        }),
        renewals: await TracerHelper.withSpan('billing', 'billing.renewal.renewals', {}, async (childSpan) => {
          const count = await this.processRenewals(db);
          childSpan.setAttribute('processed_count', count);
          return count;
        }),
        retries: await TracerHelper.withSpan('billing', 'billing.renewal.retries', {}, async (childSpan) => {
          const count = await this.processRetries(db);
          childSpan.setAttribute('processed_count', count);
          return count;
        }),
        suspensions: await TracerHelper.withSpan('billing', 'billing.renewal.suspensions', {}, async (childSpan) => {
          const count = await this.processSuspensions(db);
          childSpan.setAttribute('processed_count', count);
          return count;
        })
      };
      
      span.setAttribute('total_processed', Object.values(results).reduce((a, b) => a + b, 0));
      return results;
    });
  }
}
