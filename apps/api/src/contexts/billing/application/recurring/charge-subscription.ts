import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Redis } from 'ioredis';
import type { Database } from '../../../../shared/infra/db/schema.js';
import { env } from '../../../../app/env.js';
import { executeAsTenant } from '../../../../shared/infra/db/rls.js';
import { EntitlementsResolver } from '../../../../shared/infra/entitlements/entitlements-resolver.js';
import { invalidateDashboardCache } from '../../../../shared/infra/cache/invalidate-dashboard-cache.js';
import { NotificationService } from '../../../../shared/infra/notifications/NotificationService.js';
import { periodDaysForCycle } from '../../../platform-admin/application/billing-plans/resolve-plan.js';
import { recurringGateway, isRecurringGateway } from '../../domain/recurring-gateway.js';
import type { AutoChargeResult, IPaymentGateway } from '../../domain/payment-gateway.interface.js';
import { PaymentMethodsService } from './payment-methods.service.js';
import { SubscriptionInvoiceService } from './subscription-invoice.service.js';
import { DunningService } from './dunning.service.js';
import { retryDelayHours } from '@pos-dian/shared';

/**
 * El cobro recurrente, de verdad.
 *
 * El motor anterior tenía el cobro comentado (`// await chargeMethod()`) y un patrón de
 * bloqueo que no bloqueaba: reclamaba las suscripciones con `.forUpdate().skipLocked()`
 * dentro de una transacción que **cerraba antes de procesarlas**, de modo que los locks se
 * soltaban en el commit y dos instancias del worker podían cobrarle a la vez al mismo
 * comercio. `SU-01`.
 *
 * Aquí el cobro se hace en dos transacciones, y las dos toman `pg_advisory_xact_lock` sobre
 * la misma suscripción:
 *
 *   A. **Reservar** — dentro del lock: se confirma que sigue tocando cobrar, se emite (o se
 *      recupera) la factura del periodo, se incrementa el intento y se deja una transacción
 *      `PENDING` con su llave de idempotencia.
 *   B. **Aplicar** — dentro del lock otra vez: se asienta el resultado.
 *
 * Entre A y B no hay transacción abierta, y eso es deliberado: la llamada a la pasarela
 * tarda segundos y puede colgarse. Mantener una transacción —y un lock— abiertos durante una
 * llamada HTTP externa es cómo se agota un pool de conexiones un día de mucho tráfico. Lo
 * que protege ese hueco es la fila `PENDING` que A deja escrita: cualquier otro proceso que
 * entre después esperará el lock, verá el intento en vuelo y no cobrará por segunda vez.
 */

export type ChargeReason = 'RENEWAL' | 'RETRY' | 'TRIAL_CONVERSION' | 'MANUAL';

export type ChargeOutcome =
  | 'charged'
  | 'pending'
  | 'declined'
  | 'no_payment_method'
  | 'skipped'
  | 'error';

export interface ChargeResult {
  outcome: ChargeOutcome;
  detail?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  amountCents?: number;
}

export interface RecurringBillingDeps {
  db: Kysely<Database>;
  redis?: Redis;
  /** Pasarela inyectable: las pruebas usan la de mentira para forzar rechazos. */
  gateway?: IPaymentGateway;
  /** Reloj inyectable, para poder ensayar el ciclo completo adelantándolo. */
  now?: () => Date;
}

const LOCK_NAMESPACE = 'billing:subscription';

/**
 * Cuánto se espera antes de dar por perdido un intento en vuelo.
 *
 * Si un worker muere justo después de crear la transacción `PENDING`, ese cobro queda en el
 * limbo. Pasado este plazo se considera abandonado y se puede reintentar: la llave de
 * idempotencia que se le envía a la pasarela es la que evita el cobro doble si resulta que
 * el primero sí había llegado.
 */
const IN_FLIGHT_TIMEOUT_MINUTES = 30;

async function lockSubscription(trx: Transaction<Database>, subscriptionId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAMESPACE}), hashtext(${subscriptionId}))`.execute(trx);
}

function portalUrl(): string | undefined {
  return env.BILLING_PORTAL_URL;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

interface ChargeTicket {
  tenantId: string;
  tenantName: string;
  subscriptionId: string;
  invoiceId: string;
  invoiceNumber: string;
  periodStart: Date;
  periodEnd: Date;
  planId: string;
  planName: string;
  billingCycle: string;
  amountCents: number;
  attempt: number;
  maxRetries: number;
  transactionId: string;
  reference: string;
  gatewayName: string;
  gatewayToken: string;
  customerEmail: string;
  previousStatus: string;
}

/**
 * Cobra el periodo pendiente de una suscripción.
 *
 * Idempotente por diseño: llamarla dos veces seguidas no cobra dos veces, y llamarla cuando
 * no toca devuelve `skipped` sin efectos.
 */
export async function chargeSubscription(
  deps: RecurringBillingDeps,
  subscriptionId: string,
  reason: ChargeReason
): Promise<ChargeResult> {
  const now = deps.now?.() ?? new Date();

  // La suscripción se lee fuera del contexto de comercio porque es justo lo que hace falta
  // para saber de qué comercio es. `tenant_subscriptions` es tabla de plataforma, sin RLS.
  const head = await deps.db
    .selectFrom('tenant_subscriptions')
    .select(['id', 'tenant_id', 'status'])
    .where('id', '=', subscriptionId)
    .executeTakeFirst();

  if (!head) return { outcome: 'skipped', detail: 'La suscripción ya no existe' };
  if (head.status === 'CANCELLED') return { outcome: 'skipped', detail: 'La suscripción está cancelada' };

  /* ---------------- A. Reservar ---------------- */

  const reserved = await executeAsTenant(deps.db, head.tenant_id, async (trx) => {
    await lockSubscription(trx, subscriptionId);
    return reserveCharge(trx, { subscriptionId, tenantId: head.tenant_id, now, reason });
  });

  if ('skip' in reserved) return reserved.skip;

  const ticket = reserved.ticket;

  /* ---------------- Pasarela (sin transacción abierta) ---------------- */

  let charge: AutoChargeResult;
  try {
    const adapter =
      deps.gateway ?? recurringGateway(isRecurringGateway(ticket.gatewayName) ? ticket.gatewayName : undefined);

    charge = await adapter.chargeStoredPaymentMethod!({
      paymentMethodToken: ticket.gatewayToken,
      amountCents: ticket.amountCents,
      currency: 'COP',
      idempotencyKey: `${ticket.invoiceNumber}:${ticket.attempt}`,
      description: `${ticket.planName} · ${formatDate(ticket.periodStart)} a ${formatDate(ticket.periodEnd)}`,
      customerEmail: ticket.customerEmail,
      reference: ticket.reference
    });
  } catch (error) {
    // Una pasarela caída no es un rechazo del banco: se trata como error, se reintenta, y
    // no se le dice al comercio que le rechazaron la tarjeta cuando no es verdad.
    charge = {
      success: false,
      gatewayTransactionId: '',
      status: 'ERROR',
      declineReason: error instanceof Error ? error.message : String(error),
      rawPayload: null
    };
  }

  /* ---------------- B. Aplicar ---------------- */

  return applyChargeResult(deps, ticket, charge, now);
}

/* ------------------------------------------------------------------ *
 * A. Reservar
 * ------------------------------------------------------------------ */

/**
 * Devuelve la factura pendiente del periodo, emitiéndola si todavía no existe.
 *
 * Una factura abierta manda sobre cualquier cálculo de periodo: es lo que hace que un
 * reintento cobre exactamente lo mismo que el intento que falló —mismo importe, mismo
 * periodo, mismo número— en lugar de emitir una factura nueva cada vez.
 */
async function openInvoiceFor(
  trx: Transaction<Database>,
  input: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscription: any;
    plan: { id: string; name: string; price_cents: number; billing_cycle: string };
    tenantId: string;
    now: Date;
  }
) {
  const open = await trx
    .selectFrom('subscription_invoices')
    .selectAll()
    .where('subscription_id', '=', input.subscription.id)
    .where('status', '=', 'OPEN')
    .orderBy('period_start', 'asc')
    .executeTakeFirst();

  if (open) return open;

  const periodDays = periodDaysForCycle(input.plan.billing_cycle);

  // El periodo nuevo empieza donde terminó el anterior, no «hoy»: si no, cada cobro con un
  // día de retraso le regala ese día al comercio y el aniversario se va corriendo.
  const anchor =
    input.subscription.status === 'TRIAL'
      ? (input.subscription.trial_ends_at ?? input.subscription.current_period_end ?? input.now)
      : (input.subscription.current_period_end ?? input.now);

  const periodStart = new Date(anchor);
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodEnd.getDate() + periodDays);

  const issued = await SubscriptionInvoiceService.issueForPeriod(trx, {
    tenantId: input.tenantId,
    subscriptionId: input.subscription.id,
    planId: input.plan.id,
    planName: input.plan.name,
    billingCycle: input.plan.billing_cycle,
    periodStart,
    periodEnd,
    couponCode: input.subscription.coupon_code,
    now: input.now,
    lines: [
      {
        description: `Plan ${input.plan.name} · ${input.plan.billing_cycle === 'YEARLY' ? 'anual' : 'mensual'}`,
        quantity: 1,
        unitPriceCents: input.plan.price_cents
      }
    ]
  });

  return issued.invoice;
}

/**
 * Emite la factura del periodo sin cobrarla.
 *
 * Es el caso del comercio que no tiene medio de pago, o que apagó la renovación automática:
 * la suscripción vence igual y tiene que quedar una factura que se pueda pagar a mano. Sin
 * esto, «no se pudo cobrar» dejaba al comercio en mora sin decirle cuánto debe.
 */
export async function ensureOpenInvoice(
  deps: RecurringBillingDeps,
  subscriptionId: string
): Promise<{ invoiceId: string; invoiceNumber: string; totalCents: number } | null> {
  const now = deps.now?.() ?? new Date();

  const head = await deps.db
    .selectFrom('tenant_subscriptions')
    .select(['tenant_id', 'status'])
    .where('id', '=', subscriptionId)
    .executeTakeFirst();

  if (!head || head.status === 'CANCELLED') return null;

  return executeAsTenant(deps.db, head.tenant_id, async (trx) => {
    await lockSubscription(trx, subscriptionId);

    const subscription = await trx
      .selectFrom('tenant_subscriptions')
      .selectAll()
      .where('id', '=', subscriptionId)
      .executeTakeFirst();

    if (!subscription) return null;

    const plan = await trx
      .selectFrom('billing_plans')
      .select(['id', 'name', 'price_cents', 'billing_cycle'])
      .where('id', '=', subscription.plan_id)
      .executeTakeFirst();

    if (!plan) return null;

    const invoice = await openInvoiceFor(trx, {
      subscription,
      plan,
      tenantId: head.tenant_id,
      now
    });

    return { invoiceId: invoice.id, invoiceNumber: invoice.number, totalCents: invoice.total_cents };
  });
}

async function reserveCharge(
  trx: Transaction<Database>,
  input: { subscriptionId: string; tenantId: string; now: Date; reason: ChargeReason }
): Promise<{ ticket: ChargeTicket } | { skip: ChargeResult }> {
  const subscription = await trx
    .selectFrom('tenant_subscriptions')
    .selectAll()
    .where('id', '=', input.subscriptionId)
    .executeTakeFirst();

  if (!subscription) return { skip: { outcome: 'skipped', detail: 'La suscripción ya no existe' } };
  if (subscription.status === 'CANCELLED') {
    return { skip: { outcome: 'skipped', detail: 'La suscripción está cancelada' } };
  }

  const plan = await trx
    .selectFrom('billing_plans')
    .select(['id', 'name', 'price_cents', 'billing_cycle'])
    .where('id', '=', subscription.plan_id)
    .executeTakeFirst();

  if (!plan) {
    return { skip: { outcome: 'error', detail: `El plan ${subscription.plan_id} no existe en el catálogo` } };
  }

  const tenant = await trx
    .selectFrom('tenants')
    .select(['id', 'name'])
    .where('id', '=', input.tenantId)
    .executeTakeFirst();

  const owner = await trx
    .selectFrom('users')
    .select(['email'])
    .where('tenant_id', '=', input.tenantId)
    .where('role', '=', 'TENANT_OWNER')
    .executeTakeFirst();

  const invoice = await openInvoiceFor(trx, { subscription, plan, tenantId: input.tenantId, now: input.now });

  const method = await PaymentMethodsService.findDefault(trx, input.tenantId);

  if (!method) {
    return {
      skip: {
        outcome: 'no_payment_method',
        detail: 'El comercio no tiene un medio de pago registrado',
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        amountCents: invoice.total_cents
      }
    };
  }

  /**
   * ¿Hay un cobro en vuelo? Se comprueba **dentro del lock**, que es lo único que hace la
   * comprobación fiable: quien llegue después se queda esperando el lock y ve esta fila.
   */
  const inFlightSince = new Date(input.now.getTime() - IN_FLIGHT_TIMEOUT_MINUTES * 60_000);
  const inFlight = await trx
    .selectFrom('payment_transactions')
    .select(['id', 'created_at'])
    .where('subscription_id', '=', input.subscriptionId)
    .where('status', '=', 'PENDING')
    .where('created_at', '>=', inFlightSince)
    .executeTakeFirst();

  if (inFlight) {
    return { skip: { outcome: 'skipped', detail: 'Ya hay un cobro en curso para esta suscripción' } };
  }

  const attempt = await SubscriptionInvoiceService.registerAttempt(trx, invoice.id, input.now);

  const transactionId = randomUUID();
  const reference = `INV_${invoice.number}_${attempt}`;

  await trx
    .insertInto('payment_transactions')
    .values({
      id: transactionId,
      tenant_id: input.tenantId,
      subscription_id: input.subscriptionId,
      amount_cents: invoice.total_cents,
      currency: invoice.currency,
      gateway: method.gateway,
      gateway_reference: reference,
      status: 'PENDING',
      attempt_number: attempt,
      idempotency_key: `${invoice.number}:${attempt}`,
      metadata_json: {
        invoiceId: invoice.id,
        planId: plan.id,
        source: 'RECURRING',
        reason: input.reason,
        autoRenew: true
      }
    })
    .execute();

  await trx
    .updateTable('tenant_subscriptions')
    .set({ last_payment_attempt_at: input.now, updated_at: input.now })
    .where('id', '=', input.subscriptionId)
    .execute();

  await DunningService.record(trx, {
    tenantId: input.tenantId,
    subscriptionId: input.subscriptionId,
    invoiceId: invoice.id,
    step: 'CHARGE_ATTEMPTED',
    periodKey: DunningService.periodKey(invoice.period_start),
    attempt,
    detail: `Intento ${attempt} por ${invoice.total_cents} centavos (${input.reason})`
  });

  return {
    ticket: {
      tenantId: input.tenantId,
      tenantName: tenant?.name ?? 'Cliente',
      subscriptionId: input.subscriptionId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      periodStart: invoice.period_start,
      periodEnd: invoice.period_end,
      planId: plan.id,
      planName: plan.name,
      billingCycle: plan.billing_cycle,
      amountCents: invoice.total_cents,
      attempt,
      maxRetries: subscription.max_retries ?? env.BILLING_MAX_RETRIES,
      transactionId,
      reference,
      gatewayName: method.gateway,
      gatewayToken: method.gateway_token,
      customerEmail: owner?.email ?? '',
      previousStatus: subscription.status
    }
  };
}

/* ------------------------------------------------------------------ *
 * B. Aplicar
 * ------------------------------------------------------------------ */

async function applyChargeResult(
  deps: RecurringBillingDeps,
  ticket: ChargeTicket,
  charge: AutoChargeResult,
  now: Date
): Promise<ChargeResult> {
  const periodKey = DunningService.periodKey(ticket.periodStart);

  if (charge.status === 'PENDING') {
    /**
     * Wompi responde `PENDING` a menudo: la transacción existe y el resultado llega por
     * webhook. No se toca la suscripción ni se dispara la cobranza — dar por rechazado un
     * cobro que está en curso es la forma más rápida de suspenderle la cuenta a alguien que
     * sí pagó. La transacción se queda `PENDING` y el webhook la cierra.
     */
    await executeAsTenant(deps.db, ticket.tenantId, async (trx) => {
      await lockSubscription(trx, ticket.subscriptionId);
      await trx
        .updateTable('payment_transactions')
        .set({ gateway_transaction_id: charge.gatewayTransactionId || null, updated_at: now })
        .where('id', '=', ticket.transactionId)
        .execute();

      await DunningService.record(trx, {
        tenantId: ticket.tenantId,
        subscriptionId: ticket.subscriptionId,
        invoiceId: ticket.invoiceId,
        step: 'CHARGE_PENDING',
        periodKey,
        attempt: ticket.attempt,
        detail: 'La pasarela dejó la transacción en curso; se espera el webhook'
      });
    });

    return {
      outcome: 'pending',
      detail: 'La pasarela está procesando el cobro',
      invoiceId: ticket.invoiceId,
      invoiceNumber: ticket.invoiceNumber,
      amountCents: ticket.amountCents
    };
  }

  if (charge.success) {
    await executeAsTenant(deps.db, ticket.tenantId, async (trx) => {
      await lockSubscription(trx, ticket.subscriptionId);

      await trx
        .updateTable('payment_transactions')
        .set({
          status: 'APPROVED',
          gateway_transaction_id: charge.gatewayTransactionId || null,
          updated_at: now
        })
        .where('id', '=', ticket.transactionId)
        .execute();

      await settleInvoiceInTransaction(trx, {
        tenantId: ticket.tenantId,
        subscriptionId: ticket.subscriptionId,
        invoiceId: ticket.invoiceId,
        paymentTransactionId: ticket.transactionId,
        now
      });

      await DunningService.record(trx, {
        tenantId: ticket.tenantId,
        subscriptionId: ticket.subscriptionId,
        invoiceId: ticket.invoiceId,
        step: 'CHARGE_SUCCEEDED',
        periodKey,
        attempt: ticket.attempt,
        detail: `Cobro aprobado (${charge.gatewayTransactionId})`
      });

      if (ticket.previousStatus === 'PAST_DUE' || ticket.previousStatus === 'SUSPENDED') {
        await DunningService.record(trx, {
          tenantId: ticket.tenantId,
          subscriptionId: ticket.subscriptionId,
          invoiceId: ticket.invoiceId,
          step: 'RECOVERED',
          periodKey,
          detail: 'La cuenta salió de mora tras un cobro exitoso'
        });
      }
    });

    await invalidateCaches(deps, ticket.tenantId);

    const notifications = new NotificationService(deps.db);
    await notifications.notifyInvoicePaid(ticket.tenantId, {
      tenantName: ticket.tenantName,
      planName: ticket.planName,
      invoiceNumber: ticket.invoiceNumber,
      periodStart: formatDate(ticket.periodStart),
      periodEnd: formatDate(ticket.periodEnd),
      amountCents: ticket.amountCents,
      portalUrl: portalUrl()
    });

    return {
      outcome: 'charged',
      invoiceId: ticket.invoiceId,
      invoiceNumber: ticket.invoiceNumber,
      amountCents: ticket.amountCents
    };
  }

  /* ---------------- Rechazo ---------------- */

  const reason = charge.declineReason ?? 'La pasarela rechazó el cobro sin dar un motivo';

  const { retryCount, nextRetryAt, exhausted, suspensionDate } = await executeAsTenant(
    deps.db,
    ticket.tenantId,
    async (trx) => {
      await lockSubscription(trx, ticket.subscriptionId);

      await trx
        .updateTable('payment_transactions')
        .set({
          status: charge.status === 'ERROR' ? 'ERROR' : 'DECLINED',
          gateway_transaction_id: charge.gatewayTransactionId || null,
          metadata_json: { invoiceId: ticket.invoiceId, declineReason: reason },
          updated_at: now
        })
        .where('id', '=', ticket.transactionId)
        .execute();

      const updated = await trx
        .updateTable('tenant_subscriptions')
        .set((eb) => ({ retry_count: eb('retry_count', '+', 1), updated_at: now }))
        .where('id', '=', ticket.subscriptionId)
        .returning(['retry_count', 'grace_period_days', 'status'])
        .executeTakeFirstOrThrow();

      const count = updated.retry_count;
      /**
       * `max_retries` son los **reintentos**, no los intentos: el primer cobro no es un
       * reintento. Con el valor por defecto de 3, la secuencia es cobro + 24 h + 72 h +
       * una semana, y solo entonces se da por perdido.
       */
      const exhausted = count > ticket.maxRetries;

      // El backoff se cuenta desde el intento que acaba de fallar: 24 h, 72 h, una semana.
      const nextRetryAt = exhausted ? null : new Date(now.getTime() + retryDelayHours(count - 1) * 3_600_000);

      const graceDays = updated.grace_period_days ?? env.BILLING_GRACE_PERIOD_DAYS;
      const suspensionDate = new Date(ticket.periodStart);
      suspensionDate.setDate(suspensionDate.getDate() + graceDays);

      await trx
        .updateTable('tenant_subscriptions')
        .set({
          // `PAST_DUE` degrada el backoffice y deja la caja funcionando. Un comercio en
          // mora tiene que poder seguir vendiendo: apagarle el punto de venta no acelera el
          // pago, le hace perder el día.
          status: 'PAST_DUE',
          next_retry_at: nextRetryAt,
          dunning_stage: exhausted ? 'GIVEN_UP' : 'RETRYING',
          updated_at: now
        })
        .where('id', '=', ticket.subscriptionId)
        .execute();

      await DunningService.record(trx, {
        tenantId: ticket.tenantId,
        subscriptionId: ticket.subscriptionId,
        invoiceId: ticket.invoiceId,
        step: 'CHARGE_FAILED',
        periodKey,
        attempt: ticket.attempt,
        detail: reason,
        notified: true
      });

      if (updated.status !== 'PAST_DUE') {
        await DunningService.record(trx, {
          tenantId: ticket.tenantId,
          subscriptionId: ticket.subscriptionId,
          invoiceId: ticket.invoiceId,
          step: 'GRACE_STARTED',
          periodKey,
          detail: `Periodo de gracia de ${graceDays} días; suspensión el ${formatDate(suspensionDate)}`
        });

        await DunningService.record(trx, {
          tenantId: ticket.tenantId,
          subscriptionId: ticket.subscriptionId,
          invoiceId: ticket.invoiceId,
          step: 'DEGRADED',
          periodKey,
          detail: 'Informes y configuración restringidos; la caja sigue operando'
        });
      }

      if (exhausted) {
        await DunningService.record(trx, {
          tenantId: ticket.tenantId,
          subscriptionId: ticket.subscriptionId,
          invoiceId: ticket.invoiceId,
          step: 'GIVEN_UP',
          periodKey,
          attempt: count,
          detail: `Se agotaron los ${ticket.maxRetries + 1} intentos de cobro`
        });
      } else {
        await DunningService.record(trx, {
          tenantId: ticket.tenantId,
          subscriptionId: ticket.subscriptionId,
          invoiceId: ticket.invoiceId,
          step: 'RETRY_SCHEDULED',
          periodKey,
          attempt: count,
          detail: `Siguiente intento el ${formatDate(nextRetryAt!)}`
        });
      }

      await trx
        .insertInto('subscription_events')
        .values({
          subscription_id: ticket.subscriptionId,
          type: 'RENEWAL_FAILED',
          metadata: { attempt: ticket.attempt, reason, invoice: ticket.invoiceNumber }
        })
        .execute();

      return { retryCount: count, nextRetryAt, exhausted, suspensionDate };
    }
  );

  await invalidateCaches(deps, ticket.tenantId);

  const notifications = new NotificationService(deps.db);
  await notifications.notifyChargeFailed(ticket.tenantId, {
    tenantName: ticket.tenantName,
    planName: ticket.planName,
    amountCents: ticket.amountCents,
    reason,
    attempt: retryCount,
    totalAttempts: ticket.maxRetries + 1,
    nextRetryDate: nextRetryAt ? formatDate(nextRetryAt) : undefined,
    suspensionDate: exhausted ? formatDate(suspensionDate) : undefined,
    portalUrl: portalUrl()
  });

  return {
    outcome: 'declined',
    detail: reason,
    invoiceId: ticket.invoiceId,
    invoiceNumber: ticket.invoiceNumber,
    amountCents: ticket.amountCents
  };
}

/* ------------------------------------------------------------------ *
 * Liquidación de la factura
 * ------------------------------------------------------------------ */

/**
 * Da por pagada la factura y adelanta la suscripción a su periodo siguiente.
 *
 * Vive aquí y no dentro del cobro porque hay dos caminos que llegan al mismo sitio: el
 * cobro automático, que sabe el resultado al momento, y el webhook de la pasarela, que lo
 * trae más tarde para las transacciones que quedaron en curso. Los dos tienen que dejar la
 * suscripción exactamente igual.
 */
export async function settleInvoiceInTransaction(
  trx: Transaction<Database>,
  input: {
    tenantId: string;
    subscriptionId: string;
    invoiceId: string;
    paymentTransactionId: string | null;
    now: Date;
  }
): Promise<boolean> {
  const invoice = await trx
    .selectFrom('subscription_invoices')
    .selectAll()
    .where('id', '=', input.invoiceId)
    .where('tenant_id', '=', input.tenantId)
    .executeTakeFirst();

  if (!invoice || invoice.status !== 'OPEN') return false;

  await SubscriptionInvoiceService.markPaid(trx, invoice.id, input.paymentTransactionId, input.now);

  await trx
    .updateTable('tenant_subscriptions')
    .set({
      status: 'ACTIVE',
      current_period_start: invoice.period_start,
      current_period_end: invoice.period_end,
      expires_at: invoice.period_end,
      next_billing_at: invoice.period_end,
      retry_count: 0,
      next_retry_at: null,
      dunning_stage: null,
      suspended_at: null,
      updated_at: input.now
    })
    .where('id', '=', input.subscriptionId)
    .execute();

  // El cupón consume un periodo por factura emitida con descuento. `NULL` es cortesía
  // permanente y no se decrementa nunca.
  if (invoice.discount_cents > 0) {
    await trx
      .updateTable('tenant_subscriptions')
      .set((eb) => ({ coupon_periods_left: eb('coupon_periods_left', '-', 1) }))
      .where('id', '=', input.subscriptionId)
      .where('coupon_periods_left', 'is not', null)
      .where('coupon_periods_left', '>', 0)
      .execute();
  }

  await trx.updateTable('tenants').set({ status: 'ACTIVE' }).where('id', '=', input.tenantId).execute();

  await trx
    .insertInto('subscription_events')
    .values({
      subscription_id: input.subscriptionId,
      type: 'RENEWED',
      metadata: {
        invoice: invoice.number,
        period_start: invoice.period_start.toISOString(),
        period_end: invoice.period_end.toISOString(),
        total_cents: invoice.total_cents
      }
    })
    .execute();

  return true;
}

/**
 * Cierra desde el webhook una factura que quedó en curso.
 *
 * Es el otro extremo del `PENDING`: la pasarela confirma más tarde y el cobro tiene que
 * asentarse igual que si hubiera respondido al momento.
 */
export async function settleInvoiceFromWebhook(
  db: Kysely<Database>,
  input: {
    tenantId: string;
    invoiceId: string;
    paymentTransactionId: string | null;
    now?: Date;
  }
): Promise<boolean> {
  const now = input.now ?? new Date();

  return executeAsTenant(db, input.tenantId, async (trx) => {
    const invoice = await trx
      .selectFrom('subscription_invoices')
      .select(['id', 'subscription_id'])
      .where('id', '=', input.invoiceId)
      .where('tenant_id', '=', input.tenantId)
      .executeTakeFirst();

    if (!invoice) return false;

    await lockSubscription(trx, invoice.subscription_id);

    const settled = await settleInvoiceInTransaction(trx, {
      tenantId: input.tenantId,
      subscriptionId: invoice.subscription_id,
      invoiceId: invoice.id,
      paymentTransactionId: input.paymentTransactionId,
      now
    });

    if (settled) {
      await DunningService.record(trx, {
        tenantId: input.tenantId,
        subscriptionId: invoice.subscription_id,
        invoiceId: invoice.id,
        step: 'CHARGE_SUCCEEDED',
        periodKey: DunningService.periodKey(now),
        detail: 'Confirmado por webhook de la pasarela'
      });
    }

    return settled;
  });
}

async function invalidateCaches(deps: RecurringBillingDeps, tenantId: string): Promise<void> {
  if (!deps.redis) return;

  try {
    // El nivel de servicio depende del estado de la suscripción, y acaba de cambiar: sin
    // esto el comercio sigue viendo el producto anterior hasta que caduque la caché.
    await new EntitlementsResolver(deps.db, deps.redis).invalidate(tenantId);
    await invalidateDashboardCache(deps.redis);
  } catch {
    // Y si la caché no se deja invalidar, caduca sola en cinco minutos. Lo que no puede
    // pasar es que eso deshaga un cobro que la pasarela ya dio por bueno: el dinero ya se
    // movió, y propagar el fallo aquí dejaría la factura sin asentar.
  }
}
