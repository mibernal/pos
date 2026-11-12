import type { Kysely } from 'kysely';
import type { Redis } from 'ioredis';
import type { Database } from '../../../shared/infra/db/schema.js';
import { env } from '../../../app/env.js';
import { executeAsTenant } from '../../../shared/infra/db/rls.js';
import { NotificationService } from '../../../shared/infra/notifications/NotificationService.js';
import { EntitlementsResolver } from '../../../shared/infra/entitlements/entitlements-resolver.js';
import { TracerHelper } from '../../../shared/infra/tracing/Tracer.js';
import { SubscriptionService } from './subscription.service.js';
import {
  chargeSubscription,
  ensureOpenInvoice,
  type ChargeResult,
  type RecurringBillingDeps
} from './recurring/charge-subscription.js';
import { DunningService } from './recurring/dunning.service.js';
import { SubscriptionInvoiceService } from './recurring/subscription-invoice.service.js';
import type { IPaymentGateway } from '../domain/payment-gateway.interface.js';

/**
 * El motor de renovación.
 *
 * Lo que había antes era el esqueleto correcto con el cuerpo comentado: `processRenewals`
 * llevaba literalmente `// await chargeMethod()` y `processTrialExpirations` un
 * `// TODO: Si auto_renew es true, intentar cobrar el primer mes`. Es decir, el motor
 * corría cada día, contaba suscripciones vencidas y no cobraba ninguna.
 *
 * Y el patrón de bloqueo tampoco protegía. Las tres funciones reclamaban trabajo así:
 *
 * ```ts
 * const pendientes = await db.transaction().execute(async (trx) =>
 *   trx.selectFrom('tenant_subscriptions')...forUpdate().skipLocked().execute()
 * );                                    // ← la transacción cierra AQUÍ
 * for (const sub of pendientes) { ... } // ← y aquí ya no hay ningún lock
 * ```
 *
 * `FOR UPDATE SKIP LOCKED` solo reserva mientras la transacción sigue abierta. Al hacer el
 * commit para salir del `execute`, los locks se sueltan y dos instancias del worker
 * reclaman exactamente las mismas filas. Con los cobros comentados eso no se notaba; con
 * cobros de verdad significa cobrarle dos veces al mismo comercio. `SU-01`.
 *
 * Ahora el reclamo es una lectura sin locks —solo sirve para saber a quién mirar— y la
 * exclusión vive dentro de `chargeSubscription`, que toma `pg_advisory_xact_lock` sobre la
 * suscripción en la transacción que efectivamente escribe.
 */

export interface RenewalEngineOptions {
  redis?: Redis;
  /** Pasarela inyectable: las pruebas fuerzan rechazos con la de mentira. */
  gateway?: IPaymentGateway;
  /** Reloj inyectable, para ensayar el ciclo completo adelantándolo. */
  now?: () => Date;
}

/** Cuántas suscripciones mira cada pasada. El resto espera a la siguiente. */
const BATCH_SIZE = 200;

/** Días antes de la renovación en los que se avisa. */
const NOTICE_DAYS = [7, 3] as const;

export class RenewalEngine {
  /**
   * Avisa antes de cobrar, a los 7 y a los 3 días.
   *
   * El aviso previo no es cortesía: un cobro que llega sin anunciarse es un cobro que se
   * disputa. Y el texto cambia según haya medio de pago registrado o no, porque a quien no
   * lo tiene hay que pedirle algo, no solo informarle.
   */
  static async processUpcomingExpirations(deps: RecurringBillingDeps): Promise<number> {
    const now = deps.now?.() ?? new Date();
    let notified = 0;

    for (const days of NOTICE_DAYS) {
      const from = new Date(now);
      from.setDate(from.getDate() + days);
      from.setHours(0, 0, 0, 0);

      const to = new Date(from);
      to.setHours(23, 59, 59, 999);

      const upcoming = await deps.db
        .selectFrom('tenant_subscriptions as ts')
        .innerJoin('tenants as t', 't.id', 'ts.tenant_id')
        .innerJoin('billing_plans as p', 'p.id', 'ts.plan_id')
        .select([
          'ts.id',
          'ts.tenant_id',
          'ts.status',
          'ts.trial_ends_at',
          'ts.current_period_end',
          'ts.payment_method_id',
          'p.name as plan_name',
          'p.price_cents',
          't.name as tenant_name'
        ])
        .where('ts.status', 'in', ['TRIAL', 'ACTIVE'])
        .where((eb) =>
          eb.or([
            eb.and([
              eb('ts.status', '=', 'TRIAL'),
              eb('ts.trial_ends_at', '>=', from),
              eb('ts.trial_ends_at', '<=', to)
            ]),
            eb.and([
              eb('ts.status', '=', 'ACTIVE'),
              eb('ts.current_period_end', '>=', from),
              eb('ts.current_period_end', '<=', to)
            ])
          ])
        )
        .limit(BATCH_SIZE)
        .execute();

      const notifications = new NotificationService(deps.db);

      for (const sub of upcoming) {
        const renewalDate = sub.status === 'TRIAL' ? sub.trial_ends_at : sub.current_period_end;
        if (!renewalDate) continue;

        // El correo solo sale si el paso era nuevo. Sin esto, el scheduler manda el mismo
        // aviso en cada pasada durante los siete días previos.
        const isNew = await executeAsTenant(deps.db, sub.tenant_id, async (trx) =>
          DunningService.record(trx, {
            tenantId: sub.tenant_id,
            subscriptionId: sub.id,
            step: days === 7 ? 'NOTICE_7' : 'NOTICE_3',
            periodKey: DunningService.periodKey(renewalDate),
            detail: `Aviso de renovación a ${days} días`,
            notified: true
          })
        );

        if (!isNew) continue;

        await notifications.notifyRenewalReminder(sub.tenant_id, {
          tenantName: sub.tenant_name,
          planName: sub.plan_name,
          daysRemaining: days,
          renewalDate: renewalDate.toLocaleDateString('es-CO', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
          }),
          amountCents: sub.price_cents,
          hasPaymentMethod: Boolean(sub.payment_method_id),
          portalUrl: env.BILLING_PORTAL_URL
        });

        notified += 1;
      }
    }

    return notified;
  }

  /**
   * Cierra los periodos de prueba vencidos.
   *
   * Con medio de pago, el trial se convierte cobrando el primer periodo — que es todo lo
   * que decía aquel `TODO`. Sin él, se degrada: el comercio conserva la caja y pierde el
   * backoffice, y recibe una factura que puede pagar cuando quiera.
   */
  static async processTrialExpirations(deps: RecurringBillingDeps): Promise<number> {
    const now = deps.now?.() ?? new Date();

    const expired = await deps.db
      .selectFrom('tenant_subscriptions')
      .select(['id', 'tenant_id', 'auto_renew', 'payment_method_id'])
      .where('status', '=', 'TRIAL')
      .where('trial_ends_at', '<=', now)
      .limit(BATCH_SIZE)
      .execute();

    for (const sub of expired) {
      const result =
        sub.auto_renew && sub.payment_method_id
          ? await chargeSubscription(deps, sub.id, 'TRIAL_CONVERSION')
          : ({ outcome: 'no_payment_method' } as ChargeResult);

      await this.handleUncharged(deps, sub.id, sub.tenant_id, result, now, 'Fin del periodo de prueba');
    }

    return expired.length;
  }

  /**
   * Cobra las suscripciones que vencen hoy. Este es el cobro que no ocurría.
   */
  static async processRenewals(deps: RecurringBillingDeps): Promise<number> {
    const now = deps.now?.() ?? new Date();

    const due = await deps.db
      .selectFrom('tenant_subscriptions')
      .select(['id', 'tenant_id', 'auto_renew', 'payment_method_id'])
      .where('status', '=', 'ACTIVE')
      .where('next_billing_at', '<=', now)
      .limit(BATCH_SIZE)
      .execute();

    for (const sub of due) {
      const result =
        sub.auto_renew && sub.payment_method_id
          ? await chargeSubscription(deps, sub.id, 'RENEWAL')
          : ({ outcome: 'no_payment_method' } as ChargeResult);

      await this.handleUncharged(deps, sub.id, sub.tenant_id, result, now, 'Renovación sin medio de pago');
    }

    return due.length;
  }

  /**
   * Reintenta los cobros rechazados cuando toca según el backoff.
   *
   * La condición está en `next_retry_at`, que escribe el propio cobro al fallar. La versión
   * anterior traía todas las `PAST_DUE` y tenía la comprobación del backoff comentada
   * (`// .where('last_payment_attempt_at', '<=', backoff_date)`), así que el reintento
   * habría sido inmediato y en bucle.
   */
  static async processRetries(deps: RecurringBillingDeps): Promise<number> {
    const now = deps.now?.() ?? new Date();

    const pending = await deps.db
      .selectFrom('tenant_subscriptions')
      .select(['id', 'tenant_id'])
      /**
       * `SUSPENDED` entra a propósito. Registrar una tarjeta pone `next_retry_at` en ahora
       * mismo, así que un comercio suspendido que arregla su medio de pago se reactiva en
       * la siguiente pasada sin tener que encontrar ningún botón. No hay bucle posible: sus
       * reintentos ya están agotados, de modo que si este cobro también falla,
       * `next_retry_at` vuelve a quedar en nulo.
       */
      .where('status', 'in', ['PAST_DUE', 'SUSPENDED'])
      .where('auto_renew', '=', true)
      .where('payment_method_id', 'is not', null)
      .where('next_retry_at', 'is not', null)
      .where('next_retry_at', '<=', now)
      .limit(BATCH_SIZE)
      .execute();

    for (const sub of pending) {
      await chargeSubscription(deps, sub.id, 'RETRY');
    }

    return pending.length;
  }

  /**
   * Suspende lo que agotó su periodo de gracia.
   *
   * La gracia se cuenta desde el fin del periodo pagado, que es cuando venció el importe.
   * La factura no se anula: se marca incobrable, porque anularla borraría que se intentó
   * cobrar cuatro veces.
   */
  static async processSuspensions(deps: RecurringBillingDeps): Promise<number> {
    const now = deps.now?.() ?? new Date();

    const candidates = await deps.db
      .selectFrom('tenant_subscriptions as ts')
      .innerJoin('tenants as t', 't.id', 'ts.tenant_id')
      .innerJoin('billing_plans as p', 'p.id', 'ts.plan_id')
      .select([
        'ts.id',
        'ts.tenant_id',
        'ts.current_period_end',
        'ts.grace_period_days',
        'p.name as plan_name',
        'p.price_cents',
        't.name as tenant_name'
      ])
      .where('ts.status', '=', 'PAST_DUE')
      .where('ts.current_period_end', 'is not', null)
      .limit(BATCH_SIZE)
      .execute();

    const notifications = new NotificationService(deps.db);
    let suspended = 0;

    for (const sub of candidates) {
      const graceDays = sub.grace_period_days ?? env.BILLING_GRACE_PERIOD_DAYS;
      const deadline = new Date(sub.current_period_end);
      deadline.setDate(deadline.getDate() + graceDays);

      if (deadline > now) continue;

      const announced = await executeAsTenant(deps.db, sub.tenant_id, async (trx) => {
        await SubscriptionService.suspendSubscription(trx, sub.id, 'Periodo de gracia agotado');

        await trx
          .updateTable('tenant_subscriptions')
          .set({ next_retry_at: null, dunning_stage: 'SUSPENDED', updated_at: now })
          .where('id', '=', sub.id)
          .execute();

        await trx.updateTable('tenants').set({ status: 'SUSPENDED' }).where('id', '=', sub.tenant_id).execute();

        const open = await trx
          .selectFrom('subscription_invoices')
          .select(['id', 'period_start'])
          .where('subscription_id', '=', sub.id)
          .where('status', '=', 'OPEN')
          .execute();

        for (const invoice of open) {
          await SubscriptionInvoiceService.markUncollectible(trx, invoice.id, now);
        }

        return DunningService.record(trx, {
          tenantId: sub.tenant_id,
          subscriptionId: sub.id,
          invoiceId: open[0]?.id ?? null,
          step: 'SUSPENDED',
          periodKey: DunningService.periodKey(sub.current_period_end),
          detail: `Suspendida tras ${graceDays} días de gracia`,
          notified: true
        });
      });

      // El nivel de servicio pasa a BLOCKED: hay que tirar la caché o el comercio sigue
      // viendo el producto entero hasta que expire sola.
      if (deps.redis) {
        await new EntitlementsResolver(deps.db, deps.redis).invalidate(sub.tenant_id);
      }

      if (announced) {
        await notifications.notifySubscriptionSuspended(sub.tenant_id, {
          tenantName: sub.tenant_name,
          planName: sub.plan_name,
          amountCents: sub.price_cents,
          suspendedOn: now.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' }),
          portalUrl: env.BILLING_PORTAL_URL
        });
      }

      suspended += 1;
    }

    return suspended;
  }

  /**
   * Camino común para una suscripción que venció y no se pudo cobrar por falta de medio de
   * pago. Degrada, deja la factura abierta para que se pueda pagar a mano y avisa una vez.
   */
  private static async handleUncharged(
    deps: RecurringBillingDeps,
    subscriptionId: string,
    tenantId: string,
    result: ChargeResult,
    now: Date,
    reason: string
  ): Promise<void> {
    if (result.outcome !== 'no_payment_method') return;

    /**
     * La factura se emite igual. El periodo transcurre y se debe, se pueda cobrar o no, y
     * un comercio al que se le dice «no pudimos cobrarte» sin decirle cuánto debe ni dónde
     * pagarlo no tiene forma de arreglarlo.
     */
    const emitida = await ensureOpenInvoice(deps, subscriptionId);

    const graceDays = env.BILLING_GRACE_PERIOD_DAYS;

    const isNew = await executeAsTenant(deps.db, tenantId, async (trx) => {
      const current = await trx
        .selectFrom('tenant_subscriptions')
        .select(['status', 'current_period_end'])
        .where('id', '=', subscriptionId)
        .executeTakeFirst();

      if (!current || current.status === 'PAST_DUE' || current.status === 'SUSPENDED') return false;

      await SubscriptionService.markPastDue(trx, subscriptionId);

      await trx
        .updateTable('tenant_subscriptions')
        .set({ dunning_stage: 'NO_PAYMENT_METHOD', next_retry_at: null, updated_at: now })
        .where('id', '=', subscriptionId)
        .execute();

      const periodKey = DunningService.periodKey(current.current_period_end);

      await DunningService.record(trx, {
        tenantId,
        subscriptionId,
        invoiceId: emitida?.invoiceId ?? null,
        step: 'GRACE_STARTED',
        periodKey,
        detail: `${reason}. Periodo de gracia de ${graceDays} días`
      });

      return DunningService.record(trx, {
        tenantId,
        subscriptionId,
        invoiceId: emitida?.invoiceId ?? null,
        step: 'DEGRADED',
        periodKey,
        detail: 'Sin medio de pago registrado; informes y configuración restringidos',
        notified: true
      });
    });

    if (deps.redis) {
      await new EntitlementsResolver(deps.db, deps.redis).invalidate(tenantId);
    }

    if (!isNew) return;

    const context = await deps.db
      .selectFrom('tenant_subscriptions as ts')
      .innerJoin('tenants as t', 't.id', 'ts.tenant_id')
      .innerJoin('billing_plans as p', 'p.id', 'ts.plan_id')
      .select(['t.name as tenant_name', 'p.name as plan_name', 'p.price_cents'])
      .where('ts.id', '=', subscriptionId)
      .executeTakeFirst();

    if (!context) return;

    await new NotificationService(deps.db).notifyChargeFailed(tenantId, {
      tenantName: context.tenant_name,
      planName: context.plan_name,
      amountCents: emitida?.totalCents ?? result.amountCents ?? context.price_cents,
      reason: 'No hay un medio de pago registrado en la cuenta',
      attempt: 0,
      totalAttempts: env.BILLING_MAX_RETRIES + 1,
      portalUrl: env.BILLING_PORTAL_URL
    });
  }

  /**
   * Ejecuta el ciclo entero, en este orden y no en otro: se avisa antes de cobrar, se cobra
   * antes de reintentar, y se suspende al final, cuando ya se agotó todo lo demás.
   */
  static async runAll(db: Kysely<Database>, options: RenewalEngineOptions = {}) {
    const deps: RecurringBillingDeps = {
      db,
      redis: options.redis,
      gateway: options.gateway,
      now: options.now
    };

    return TracerHelper.withSpan('billing', 'billing.renewal.run_all', {}, async (span) => {
      const step = async <T>(name: string, run: () => Promise<T>) =>
        TracerHelper.withSpan('billing', `billing.renewal.${name}`, {}, async (childSpan) => {
          const count = await run();
          childSpan.setAttribute('processed_count', Number(count));
          return count;
        });

      const results = {
        upcoming: await step('upcoming_expirations', () => this.processUpcomingExpirations(deps)),
        trials: await step('trial_expirations', () => this.processTrialExpirations(deps)),
        renewals: await step('renewals', () => this.processRenewals(deps)),
        retries: await step('retries', () => this.processRetries(deps)),
        suspensions: await step('suspensions', () => this.processSuspensions(deps))
      };

      span.setAttribute('total_processed', Object.values(results).reduce((a, b) => a + b, 0));
      return results;
    });
  }
}
