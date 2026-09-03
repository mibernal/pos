import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { env } from '../../../app/env.js';
import { registerPaymentMethodSchema, INVOICE_STATUS_LABELS } from '@pos-dian/shared';
import { LIVE_SUBSCRIPTION_STATUSES } from '../application/subscription.service.js';
import { PaymentMethodsService } from '../application/recurring/payment-methods.service.js';
import { SubscriptionInvoiceService } from '../application/recurring/subscription-invoice.service.js';
import { DunningService } from '../application/recurring/dunning.service.js';
import { chargeSubscription } from '../application/recurring/charge-subscription.js';
import { serviceLevelFor } from '../../../shared/infra/entitlements/entitlements-resolver.js';

/**
 * El portal de facturación del comercio.
 *
 * Hasta ahora la única pantalla de cobro era el checkout: se pagaba y no se volvía a ver
 * nada. Un comercio que quiere saber cuánto le van a cobrar, con qué tarjeta, cuándo, y que
 * necesita la factura del mes pasado para su contador, no tenía dónde mirarlo — y acababa
 * escribiendo a soporte, que es la forma más cara de responder una pregunta.
 */

/** Facturar es cosa del dueño o del administrador, no de cualquiera con sesión abierta. */
function assertBillingRole(request: FastifyRequest): { tenantId: string; email: string } {
  if (!request.auth) throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');

  const auth = request.auth as typeof request.auth & { isImpersonating?: boolean };
  const allowed =
    auth.role === 'TENANT_OWNER' || auth.role === 'ADMIN' || auth.isPlatformRole || auth.isImpersonating;

  if (!allowed) {
    throw new AppError(403, 'AUTH_FORBIDDEN', 'Solo el propietario o administrador puede ver la facturación');
  }

  if (!auth.tenantId) throw new AppError(400, 'TENANT_REQUIRED', 'La sesión no tiene comercio asociado');

  return { tenantId: auth.tenantId, email: auth.email };
}

export const billingPortalRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Todo lo que el comercio necesita saber de su cuenta, en una sola petición: plan,
   * consumo contra los límites, medio de pago, facturas y el rastro de la cobranza.
   */
  typedApp.get(
    '/billing/portal',
    { preHandler: [app.authenticate], schema: { tags: ['billing'], security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { tenantId } = assertBillingRole(request);
      const now = new Date();

      const subscription = await app.db
        .selectFrom('tenant_subscriptions as ts')
        .innerJoin('billing_plans as p', 'p.id', 'ts.plan_id')
        .select([
          'ts.id',
          'ts.plan_id',
          'ts.status',
          'ts.auto_renew',
          'ts.current_period_start',
          'ts.current_period_end',
          'ts.next_billing_at',
          'ts.trial_ends_at',
          'ts.cancelled_at',
          'ts.coupon_code',
          'ts.retry_count',
          'ts.max_retries',
          'ts.next_retry_at',
          'p.name as plan_name',
          'p.price_cents',
          'p.billing_cycle'
        ])
        .where('ts.tenant_id', '=', tenantId)
        .where('ts.status', 'in', LIVE_SUBSCRIPTION_STATUSES)
        .orderBy('ts.created_at', 'desc')
        .executeTakeFirst();

      if (!subscription) {
        throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'Este comercio no tiene una suscripción activa');
      }

      const usage = await app.entitlementGuard.usage(app.db, tenantId);

      const { paymentMethod, invoices, dunning } = await request.executeAsTenant(async (trx) => {
        // Una tarjeta vencida se marca al mirarla, para que el portal lo diga antes de que
        // lo diga un cobro rechazado.
        await PaymentMethodsService.expireStale(trx, tenantId, now);

        return {
          paymentMethod: (await PaymentMethodsService.list(trx, tenantId)).find((m) => m.is_default) ?? null,
          invoices: await SubscriptionInvoiceService.history(trx, tenantId),
          dunning: await DunningService.trail(trx, tenantId)
        };
      });

      return {
        subscription: {
          id: subscription.id,
          plan_id: subscription.plan_id,
          plan_name: subscription.plan_name,
          price_cents: subscription.price_cents,
          billing_cycle: subscription.billing_cycle,
          status: subscription.status,
          service_level: serviceLevelFor(subscription.status),
          auto_renew: subscription.auto_renew,
          current_period_start: subscription.current_period_start?.toISOString() ?? null,
          current_period_end: subscription.current_period_end?.toISOString() ?? null,
          next_billing_at: subscription.next_billing_at?.toISOString() ?? null,
          trial_ends_at: subscription.trial_ends_at?.toISOString() ?? null,
          cancelled_at: subscription.cancelled_at?.toISOString() ?? null,
          coupon_code: subscription.coupon_code,
          retry_count: subscription.retry_count,
          max_retries: subscription.max_retries,
          next_retry_at: subscription.next_retry_at?.toISOString() ?? null
        },
        usage,
        payment_method: paymentMethod,
        invoices,
        dunning
      };
    }
  );

  /**
   * Lo que el navegador necesita para tokenizar la tarjeta contra la pasarela.
   *
   * La llave pública sale; la privada no existe fuera del servidor. Es la separación que
   * hace que el número de la tarjeta nunca toque nuestra infraestructura.
   */
  typedApp.get(
    '/billing/gateway-config',
    { preHandler: [app.authenticate], schema: { tags: ['billing'], security: [{ bearerAuth: [] }] } },
    async (request) => {
      assertBillingRole(request);

      return {
        gateway: env.BILLING_RECURRING_GATEWAY,
        public_key: env.BILLING_RECURRING_GATEWAY === 'MOCK' ? 'pub_mock' : (env.WOMPI_PUBLIC_KEY ?? null),
        tokenization_url:
          env.BILLING_RECURRING_GATEWAY === 'MOCK' ? null : `${env.WOMPI_API_URL}/tokens/cards`,
        acceptance_url:
          env.BILLING_RECURRING_GATEWAY === 'MOCK'
            ? null
            : `${env.WOMPI_API_URL}/merchants/${env.WOMPI_PUBLIC_KEY ?? ''}`,
        configured: env.BILLING_RECURRING_GATEWAY === 'MOCK' || Boolean(env.WOMPI_PUBLIC_KEY)
      };
    }
  );

  typedApp.post(
    '/billing/payment-methods',
    {
      preHandler: [app.authenticate],
      schema: { tags: ['billing'], security: [{ bearerAuth: [] }], body: registerPaymentMethodSchema }
    },
    async (request, reply) => {
      const { tenantId, email } = assertBillingRole(request);
      const body = registerPaymentMethodSchema.parse(request.body);

      const method = await request.executeAsTenant(async (trx) =>
        PaymentMethodsService.register(trx, {
          tenantId,
          gateway: body.gateway,
          cardToken: body.card_token,
          acceptanceToken: body.acceptance_token,
          customerEmail: body.customer_email ?? email,
          makeDefault: body.make_default
        })
      );

      await app.entitlements.invalidate(tenantId);

      return reply.code(201).send({ payment_method: method });
    }
  );

  typedApp.get(
    '/billing/payment-methods',
    { preHandler: [app.authenticate], schema: { tags: ['billing'], security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { tenantId } = assertBillingRole(request);
      const methods = await request.executeAsTenant(async (trx) => PaymentMethodsService.list(trx, tenantId));
      return { payment_methods: methods };
    }
  );

  typedApp.delete(
    '/billing/payment-methods/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['billing'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() })
      }
    },
    async (request, reply) => {
      const { tenantId } = assertBillingRole(request);
      await request.executeAsTenant(async (trx) => PaymentMethodsService.remove(trx, tenantId, request.params.id));
      return reply.code(204).send();
    }
  );

  /**
   * Cobrar ahora. Es el botón de «ya arreglé la tarjeta, cóbrame» — sin él, quien resuelve
   * su problema a las nueve de la mañana tiene que esperar al siguiente reintento
   * programado, que puede ser dentro de tres días.
   */
  typedApp.post(
    '/billing/pay-now',
    { preHandler: [app.authenticate], schema: { tags: ['billing'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { tenantId } = assertBillingRole(request);

      const subscription = await app.db
        .selectFrom('tenant_subscriptions')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('status', 'in', LIVE_SUBSCRIPTION_STATUSES)
        .orderBy('created_at', 'desc')
        .executeTakeFirst();

      if (!subscription) {
        throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'Este comercio no tiene una suscripción activa');
      }

      const result = await chargeSubscription({ db: app.db, redis: app.redis }, subscription.id, 'MANUAL');

      if (result.outcome === 'no_payment_method') {
        throw new AppError(400, 'PAYMENT_METHOD_REQUIRED', 'Registra un medio de pago antes de cobrar');
      }

      const status = result.outcome === 'charged' ? 200 : result.outcome === 'declined' ? 402 : 202;
      return reply.code(status).send(result);
    }
  );

  typedApp.post(
    '/billing/coupons/redeem',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['billing'],
        security: [{ bearerAuth: [] }],
        body: z.object({ code: z.string().min(3).max(40) })
      }
    },
    async (request, reply) => {
      const { tenantId } = assertBillingRole(request);
      const code = request.body.code.trim().toUpperCase();
      const now = new Date();

      const result = await request.executeAsTenant(async (trx) => {
        const redeemed = await SubscriptionInvoiceService.redeemCoupon(trx, tenantId, code, now);
        if (!redeemed.ok) return redeemed;

        await trx
          .updateTable('tenant_subscriptions')
          .set({ coupon_code: code, coupon_periods_left: redeemed.periods, updated_at: now })
          .where('tenant_id', '=', tenantId)
          .where('status', 'in', LIVE_SUBSCRIPTION_STATUSES)
          .execute();

        return redeemed;
      });

      if (!result.ok) throw new AppError(400, 'COUPON_INVALID', result.reason);

      return reply.send({ code, periods: result.periods });
    }
  );

  /**
   * La factura, imprimible. HTML y no PDF: se abre en cualquier dispositivo, se guarda como
   * PDF desde el propio navegador y no arrastra una dependencia de composición al servidor
   * para un documento de doce líneas.
   */
  typedApp.get(
    '/billing/invoices/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['billing'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() })
      }
    },
    async (request, reply) => {
      const { tenantId } = assertBillingRole(request);

      const data = await request.executeAsTenant(async (trx) => {
        const invoice = await trx
          .selectFrom('subscription_invoices')
          .selectAll()
          .where('id', '=', request.params.id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();

        if (!invoice) return null;

        const items = await trx
          .selectFrom('subscription_invoice_items')
          .selectAll()
          .where('invoice_id', '=', invoice.id)
          .orderBy('sort_order', 'asc')
          .execute();

        const tenant = await trx
          .selectFrom('tenants')
          .select(['name', 'nit'])
          .where('id', '=', tenantId)
          .executeTakeFirst();

        return { invoice, items, tenant };
      });

      if (!data) throw new AppError(404, 'INVOICE_NOT_FOUND', 'La factura no existe');

      return reply.type('text/html; charset=utf-8').send(renderInvoiceHtml(data));
    }
  );
};

/* ------------------------------------------------------------------ *
 * Factura imprimible
 * ------------------------------------------------------------------ */

function pesos(cents: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(
    Math.round(cents) / 100
  );
}

function fecha(value: Date): string {
  return value.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Escapa lo que viene de la base: el nombre del comercio lo escribe el comercio. */
function esc(value: string | null | undefined): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}

function renderInvoiceHtml(data: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tenant: any;
}): string {
  const { invoice, items, tenant } = data;
  const estado = INVOICE_STATUS_LABELS[invoice.status as keyof typeof INVOICE_STATUS_LABELS] ?? invoice.status;

  const filas = items
    .map(
      (item) => `
        <tr>
          <td>${esc(item.description)}</td>
          <td class="num">${Number(item.quantity)}</td>
          <td class="num">${pesos(item.unit_price_cents)}</td>
          <td class="num">${pesos(item.amount_cents)}</td>
        </tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Factura ${esc(invoice.number)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #111827; max-width: 760px; margin: 0 auto; padding: 32px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #6b7280; font-size: 13px; }
  .estado { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;
            background: ${invoice.status === 'PAID' ? '#dcfce7' : invoice.status === 'OPEN' ? '#fef3c7' : '#fee2e2'};
            color: ${invoice.status === 'PAID' ? '#166534' : invoice.status === 'OPEN' ? '#92400e' : '#991b1b'}; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  th, td { padding: 8px 6px; text-align: left; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  .num { text-align: right; }
  .totales { margin-left: auto; margin-top: 16px; width: 280px; }
  .totales td { border: none; padding: 4px 0; }
  .totales .final td { border-top: 2px solid #111827; font-weight: 700; font-size: 16px; padding-top: 8px; }
  @media print { body { padding: 0; } .noprint { display: none; } }
</style></head><body>
<header>
  <div>
    <h1>Factura ${esc(invoice.number)}</h1>
    <div class="muted">Emitida el ${fecha(invoice.issued_at)}</div>
    <div class="muted">Periodo ${fecha(invoice.period_start)} — ${fecha(invoice.period_end)}</div>
  </div>
  <div style="text-align:right">
    <span class="estado">${esc(estado)}</span>
    <div class="muted" style="margin-top:8px">${esc(tenant?.name)}</div>
    ${tenant?.nit ? `<div class="muted">NIT ${esc(tenant.nit)}</div>` : ''}
  </div>
</header>

<table>
  <thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Valor</th><th class="num">Total</th></tr></thead>
  <tbody>${filas}</tbody>
</table>

<table class="totales">
  <tr><td>Subtotal</td><td class="num">${pesos(invoice.subtotal_cents)}</td></tr>
  ${invoice.discount_cents > 0 ? `<tr><td>Descuento${invoice.coupon_code ? ` (${esc(invoice.coupon_code)})` : ''}</td><td class="num">- ${pesos(invoice.discount_cents)}</td></tr>` : ''}
  <tr><td>IVA</td><td class="num">${pesos(invoice.tax_cents)}</td></tr>
  <tr class="final"><td>Total</td><td class="num">${pesos(invoice.total_cents)}</td></tr>
</table>

${invoice.paid_at ? `<p class="muted">Pagada el ${fecha(invoice.paid_at)}.</p>` : ''}
<p class="noprint muted" style="margin-top:32px">Usa la opción de imprimir de tu navegador para guardarla como PDF.</p>
</body></html>`;
}
