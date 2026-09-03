import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import { WompiGateway } from '../domain/wompi-gateway.js';
import { MercadoPagoGateway } from '../domain/mercadopago-gateway.js';
import { StripeGateway } from '../domain/stripe-gateway.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';
import { SubscriptionService } from './subscription.service.js';
import { periodDaysForCycle } from '../../platform-admin/application/billing-plans/resolve-plan.js';
import { NotificationService } from '../../../shared/infra/notifications/NotificationService.js';
import { executeAsTenant } from '../../../shared/infra/db/rls.js';
import { settleInvoiceFromWebhook } from './recurring/charge-subscription.js';
import { TracerHelper } from '../../../shared/infra/tracing/Tracer.js';
import { SemanticAttributes } from '../../../shared/infra/tracing/SemanticAttributes.js';

interface WebhookInput {
  gateway: 'WOMPI' | 'MERCADOPAGO' | 'STRIPE';
  headers: Record<string, string>;
  rawBody: string;
}

/**
 * Desenlace del webhook, para que la ruta elija el código HTTP con criterio.
 *
 * - `rejected`   → la firma no valida. 400: la pasarela no debe reintentar y el intento
 *                  queda registrado.
 * - `ignored`    → el evento no es nuestro, o no trae referencia. 200.
 * - `duplicate`  → ya se procesó. 200, que es lo que espera un reintento legítimo.
 * - `processed`  → se aplicó. 200.
 * - `failed`     → falló algo nuestro. 500, **para que la pasarela reintente**. Antes esto
 *                  respondía 200 y el cobro se perdía en silencio.
 */
export type WebhookOutcome = 'rejected' | 'ignored' | 'duplicate' | 'processed' | 'failed';

export interface WebhookProcessResult {
  outcome: WebhookOutcome;
  detail?: string;
  eventLogId?: string;
}

function gatewayFor(name: WebhookInput['gateway']) {
  if (name === 'WOMPI') return new WompiGateway();
  if (name === 'STRIPE') return new StripeGateway();
  return new MercadoPagoGateway();
}

export async function processPaymentWebhook(
  db: Kysely<Database>,
  input: WebhookInput
): Promise<WebhookProcessResult> {
  return TracerHelper.withSpan(
    'billing',
    'billing.webhook.process',
    { [SemanticAttributes.GATEWAY_NAME]: input.gateway },
    async (span) => {
      const adapter = gatewayFor(input.gateway);
      const eventLogId = randomUUID();

      const signatureValid = adapter.verifyWebhookSignature(input.headers, input.rawBody);

      let payload: unknown = null;
      try {
        payload = JSON.parse(input.rawBody);
      } catch {
        payload = { unparsable_body: input.rawBody.slice(0, 2000) };
      }

      // El evento se registra antes de tocar nada. Si lo que sigue falla, queda de dónde
      // reconstruirlo: ese era justamente el agujero de responder 200 a todo.
      const logEvent = async (fields: {
        status: string;
        reference?: string | null;
        eventId?: string | null;
        amountCents?: number | null;
        error?: string | null;
        processed?: boolean;
      }) => {
        try {
          await db
            .insertInto('payment_webhook_events')
            .values({
              id: eventLogId,
              gateway: input.gateway,
              event_id: fields.eventId ?? null,
              reference: fields.reference ?? null,
              signature_valid: signatureValid,
              status: fields.status,
              amount_cents: fields.amountCents ?? null,
              payload_json: payload as never,
              error: fields.error ?? null,
              processed_at: fields.processed ? new Date() : null
            })
            // El índice único es parcial (`WHERE event_id IS NOT NULL`), así que la
            // inferencia del ON CONFLICT tiene que repetir el mismo predicado o Postgres
            // no encuentra el índice y rechaza la sentencia entera.
            .onConflict((oc) => oc.columns(['gateway', 'event_id']).where('event_id', 'is not', null).doNothing())
            .execute();
        } catch {
          // Registrar el evento nunca debe tumbar el procesamiento del cobro.
        }
      };

      if (!signatureValid) {
        await logEvent({ status: 'REJECTED', error: 'Firma de webhook inválida' });
        span.setAttribute(SemanticAttributes.WEBHOOK_STATUS_RESULT, 'rejected');
        return { outcome: 'rejected', detail: 'Firma de webhook inválida', eventLogId };
      }

      const result = await adapter.parseWebhook(payload);

      if (!result.reference) {
        // Algunas pasarelas envían eventos generales sin referencia. No son nuestros.
        await logEvent({ status: 'IGNORED', eventId: result.eventId, error: 'Evento sin referencia' });
        span.setAttribute(SemanticAttributes.WEBHOOK_STATUS_RESULT, 'ignored');
        return { outcome: 'ignored', eventLogId };
      }

      span.setAttribute(SemanticAttributes.TRANSACTION_REFERENCE, result.reference);

      // Idempotencia por id de evento: un reintento de la pasarela choca contra el índice
      // único y no vuelve a aplicarse, sin depender del estado de la transacción.
      if (result.eventId) {
        const seen = await db
          .selectFrom('payment_webhook_events')
          .select('id')
          .where('gateway', '=', input.gateway)
          .where('event_id', '=', result.eventId)
          .executeTakeFirst();

        if (seen) {
          span.setAttribute(SemanticAttributes.WEBHOOK_STATUS_RESULT, 'duplicate');
          return { outcome: 'duplicate', eventLogId: seen.id };
        }
      }

      const tx = await db
        .selectFrom('payment_transactions')
        .select(['id', 'tenant_id', 'status', 'metadata_json', 'amount_cents'])
        .where('gateway_reference', '=', result.reference)
        .executeTakeFirst();

      if (!tx) {
        await logEvent({
          status: 'IGNORED',
          reference: result.reference,
          eventId: result.eventId,
          error: 'La referencia no corresponde a ninguna transacción propia'
        });
        return { outcome: 'ignored', eventLogId };
      }

      // El importe se contrasta antes de conceder nada. La firma prueba que el mensaje
      // viene de la pasarela; no prueba que se haya cobrado lo que vale el plan.
      if (result.status === 'APPROVED' && typeof result.amountCents === 'number' && result.amountCents !== tx.amount_cents) {
        const detail = `El importe informado (${result.amountCents}) no coincide con el de la transacción (${tx.amount_cents})`;
        await logEvent({
          status: 'REJECTED',
          reference: result.reference,
          eventId: result.eventId,
          amountCents: result.amountCents,
          error: detail
        });
        span.setAttribute(SemanticAttributes.WEBHOOK_STATUS_RESULT, 'amount_mismatch');
        return { outcome: 'rejected', detail, eventLogId };
      }

      if (tx.status === 'APPROVED') {
        await logEvent({
          status: 'IGNORED',
          reference: result.reference,
          eventId: result.eventId,
          amountCents: result.amountCents,
          error: 'La transacción ya estaba aprobada'
        });
        return { outcome: 'duplicate', eventLogId };
      }

      try {
        const newStatus = result.status;

        const updateResult = await db
          .updateTable('payment_transactions')
          .set({
            status: newStatus,
            gateway_transaction_id: result.gatewayTransactionId || null,
            updated_at: new Date()
          })
          .where('id', '=', tx.id)
          .where('status', '!=', 'APPROVED')
          .executeTakeFirst();

        if (Number(updateResult.numUpdatedRows) === 0) {
          // Otro proceso la aprobó de forma concurrente.
          await logEvent({
            status: 'IGNORED',
            reference: result.reference,
            eventId: result.eventId,
            amountCents: result.amountCents,
            error: 'Aprobada de forma concurrente por otro proceso'
          });
          return { outcome: 'duplicate', eventLogId };
        }

        const notificationService = new NotificationService(db);
        const tenant = await db.selectFrom('tenants').select(['name']).where('id', '=', tx.tenant_id).executeTakeFirst();
        const tenantName = tenant?.name || 'Cliente';

        if (newStatus === 'DECLINED' || newStatus === 'ERROR') {
          await notificationService.notifyPaymentRejected(tx.tenant_id, {
            tenantName,
            reason: 'El banco o la pasarela de pagos rechazó la transacción.'
          });
        }

        if (newStatus === 'APPROVED') {
          await applyApprovedPayment(db, {
            tenantId: tx.tenant_id,
            tenantName,
            metadata: tx.metadata_json,
            amountCents: tx.amount_cents,
            transactionId: tx.id,
            notificationService
          });
        }

        await logEvent({
          status: 'PROCESSED',
          reference: result.reference,
          eventId: result.eventId,
          amountCents: result.amountCents,
          processed: true
        });

        span.setAttribute(SemanticAttributes.WEBHOOK_STATUS_RESULT, newStatus);
        return { outcome: 'processed', detail: newStatus, eventLogId };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await logEvent({
          status: 'FAILED',
          reference: result.reference,
          eventId: result.eventId,
          amountCents: result.amountCents,
          error: detail
        });
        TracerHelper.setSpanError(span, error instanceof Error ? error : new Error(detail));
        // Se propaga como `failed` para que la ruta responda 5xx y la pasarela reintente.
        return { outcome: 'failed', detail, eventLogId };
      }
    }
  );
}

/**
 * Aplica un pago aprobado: activa o renueva la suscripción por el periodo que corresponde
 * al ciclo del plan.
 *
 * Antes se sumaban 30 días fijos aunque el plan fuera anual y aunque a la pasarela se le
 * hubiera pedido cobrar el año entero.
 */
async function applyApprovedPayment(
  db: Kysely<Database>,
  input: {
    tenantId: string;
    tenantName: string;
    metadata: unknown;
    amountCents: number;
    transactionId: string;
    notificationService: NotificationService;
  }
) {
  const meta = (input.metadata ?? {}) as { planId?: string; autoRenew?: boolean; invoiceId?: string };
  const planId = meta.planId;

  /**
   * Cobro recurrente que la pasarela dejó en curso y ahora confirma.
   *
   * Tiene su propio camino porque ya hay una factura emitida con su periodo: aplicarle la
   * lógica del checkout —que suma días a partir de hoy— movería el aniversario del comercio
   * cada vez que la pasarela tarda en responder.
   */
  if (meta.invoiceId) {
    const settled = await settleInvoiceFromWebhook(db, {
      tenantId: input.tenantId,
      invoiceId: meta.invoiceId,
      paymentTransactionId: input.transactionId
    });

    if (settled) {
      const invoice = await db
        .selectFrom('subscription_invoices')
        .select(['number', 'plan_name', 'period_start', 'period_end', 'total_cents'])
        .where('id', '=', meta.invoiceId)
        .executeTakeFirst();

      if (invoice) {
        await input.notificationService.notifyInvoicePaid(input.tenantId, {
          tenantName: input.tenantName,
          planName: invoice.plan_name,
          invoiceNumber: invoice.number,
          periodStart: invoice.period_start.toLocaleDateString('es-CO'),
          periodEnd: invoice.period_end.toLocaleDateString('es-CO'),
          amountCents: invoice.total_cents
        });
      }
    }

    return;
  }

  if (!planId) return;

  const plan = await db
    .selectFrom('billing_plans')
    .select(['id', 'name', 'billing_cycle'])
    .where('id', '=', planId)
    .executeTakeFirst();

  const periodDays = periodDaysForCycle(plan?.billing_cycle ?? 'MONTHLY');
  const autoRenew = meta.autoRenew === true;

  let previousPlanId: string | null = null;

  // El contexto de comercio se fija a mano: una petición de la pasarela no trae sesión, y
  // la API corre con un rol sin BYPASSRLS. Sin esto, `writeAuditLog` y las escrituras sobre
  // la suscripción las deniega RLS — y el cobro quedaba cobrado y sin aplicar. Es el mismo
  // problema que el webhook de la DIAN resolvió llevando el comercio en la ruta.
  await executeAsTenant(db, input.tenantId, async (trx) => {
    const sub = await trx
      .selectFrom('tenant_subscriptions')
      .select(['plan_id', 'status'])
      .where('tenant_id', '=', input.tenantId)
      .where('status', 'in', ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'])
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    previousPlanId = sub?.plan_id ?? null;

    await trx.updateTable('tenants').set({ status: 'ACTIVE' }).where('id', '=', input.tenantId).execute();

    if (sub?.plan_id !== planId) {
      await SubscriptionService.upgradeSubscription(trx, input.tenantId, planId);
    }

    if (sub?.status === 'ACTIVE') {
      await SubscriptionService.renewSubscription(trx, input.tenantId, periodDays);
    } else {
      await SubscriptionService.activateSubscription(trx, input.tenantId, periodDays);
    }

    await trx
      .updateTable('tenant_subscriptions')
      .set({ auto_renew: autoRenew, updated_at: new Date() })
      .where('tenant_id', '=', input.tenantId)
      .where('status', 'in', ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'])
      .execute();

    await writeAuditLog(trx, {
      tenantId: input.tenantId,
      entityType: 'TENANT',
      entityId: input.tenantId,
      action: 'TENANT_SUBSCRIPTION_PROCESSED',
      payloadJson: {
        previous: { plan: sub?.plan_id },
        current: { plan: planId, period_days: periodDays, billing_cycle: plan?.billing_cycle ?? 'MONTHLY' }
      }
    });
  });

  // Las notificaciones van **después** del commit: un fallo del proveedor de correo no
  // puede deshacer un cobro que la pasarela ya dio por bueno.
  await input.notificationService.notifyPaymentApproved(input.tenantId, {
    tenantName: input.tenantName,
    planName: plan?.name ?? planId,
    // El importe sale de la transacción registrada al crear el checkout. Antes se leía de
    // `metadata_json.amount`, una clave que nunca se escribió: el correo decía siempre $0.
    amount: input.amountCents,
    currency: 'COP'
  });

  if (previousPlanId && previousPlanId !== planId) {
    await input.notificationService.notifyPlanChanged(input.tenantId, {
      tenantName: input.tenantName,
      oldPlanName: previousPlanId,
      newPlanName: plan?.name ?? planId
    });
  }
}
