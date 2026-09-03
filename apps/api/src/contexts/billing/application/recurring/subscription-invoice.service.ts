import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { Database } from '../../../../shared/infra/db/schema.js';
import { env } from '../../../../app/env.js';
import { computeInvoiceAmounts, type CouponType, type SubscriptionInvoice } from '@pos-dian/shared';

export interface InvoiceLine {
  description: string;
  quantity?: number;
  unitPriceCents: number;
}

export interface IssueInvoiceInput {
  tenantId: string;
  subscriptionId: string;
  planId: string;
  planName: string;
  billingCycle: string;
  periodStart: Date;
  periodEnd: Date;
  lines: InvoiceLine[];
  couponCode?: string | null;
  now: Date;
}

/**
 * Emisión y liquidación de la factura del SaaS.
 *
 * `SU-06`: hasta ahora un cobro dejaba una fila en `payment_transactions` y nada más. El
 * comercio no tenía qué darle a su contador, y nosotros no teníamos con qué responder a un
 * «¿esto de qué mes es?» — la propia transacción no sabe a qué periodo corresponde.
 */
export class SubscriptionInvoiceService {
  /**
   * Reserva el siguiente número del consecutivo.
   *
   * El `UPDATE ... RETURNING` sobre la única fila del contador es lo que serializa: dos
   * facturas simultáneas se ponen en fila en lugar de llevarse el mismo número. La tabla es
   * catálogo global —el que factura somos nosotros— y por eso no lleva RLS.
   */
  static async allocateNumber(trx: Transaction<Database>): Promise<string> {
    const row = await trx
      .updateTable('billing_invoice_sequences')
      .set((eb) => ({ last_number: eb('last_number', '+', 1), updated_at: new Date() }))
      .where('scope', '=', 'DEFAULT')
      .returning(['prefix', 'last_number'])
      .executeTakeFirstOrThrow();

    return `${row.prefix}-${String(row.last_number).padStart(6, '0')}`;
  }

  /**
   * Devuelve el descuento vigente del comercio, si el cupón sigue siendo aplicable.
   *
   * Se comprueba aquí y no al canjearlo porque un cupón puede caducar entre el canje y el
   * cobro: `REPEATING` de tres periodos deja de aplicar en el cuarto, y `valid_until` puede
   * haber pasado.
   */
  static async resolveDiscount(
    trx: Transaction<Database>,
    couponCode: string | null | undefined,
    periodsLeft: number | null,
    now: Date
  ): Promise<{ type: CouponType; value: number; code: string } | null> {
    if (!couponCode) return null;
    if (periodsLeft !== null && periodsLeft <= 0) return null;

    const coupon = await trx
      .selectFrom('billing_coupons')
      .select(['code', 'type', 'value', 'duration', 'valid_from', 'valid_until', 'active'])
      .where('code', '=', couponCode)
      .executeTakeFirst();

    if (!coupon || !coupon.active) return null;
    if (coupon.valid_from && coupon.valid_from > now) return null;
    if (coupon.valid_until && coupon.valid_until < now) return null;

    return { type: coupon.type as CouponType, value: Number(coupon.value), code: coupon.code };
  }

  /**
   * Emite la factura del periodo, o devuelve la que ya existe.
   *
   * La idempotencia es del índice único `(subscription_id, period_start)`, no de una
   * comprobación previa: el motor puede correr cada hora y dos instancias a la vez sin que
   * un comercio reciba dos facturas del mismo mes.
   */
  static async issueForPeriod(trx: Transaction<Database>, input: IssueInvoiceInput) {
    const existing = await trx
      .selectFrom('subscription_invoices')
      .selectAll()
      .where('subscription_id', '=', input.subscriptionId)
      .where('period_start', '=', input.periodStart)
      .where('status', '!=', 'VOID')
      .executeTakeFirst();

    if (existing) return { invoice: existing, created: false };

    const subtotal = input.lines.reduce(
      (total, line) => total + Math.round(line.unitPriceCents * (line.quantity ?? 1)),
      0
    );

    const discount = await this.resolveDiscount(trx, input.couponCode, null, input.now);
    const amounts = computeInvoiceAmounts(
      subtotal,
      discount ? { type: discount.type, value: discount.value } : null,
      env.BILLING_TAX_RATE
    );

    const id = randomUUID();
    const number = await this.allocateNumber(trx);

    const dueAt = new Date(input.now);
    dueAt.setDate(dueAt.getDate() + env.BILLING_INVOICE_DUE_DAYS);

    await trx
      .insertInto('subscription_invoices')
      .values({
        id,
        tenant_id: input.tenantId,
        subscription_id: input.subscriptionId,
        number,
        status: 'OPEN',
        plan_id: input.planId,
        plan_name: input.planName,
        billing_cycle: input.billingCycle,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        subtotal_cents: amounts.subtotalCents,
        discount_cents: amounts.discountCents,
        tax_cents: amounts.taxCents,
        total_cents: amounts.totalCents,
        currency: 'COP',
        coupon_code: discount?.code ?? null,
        attempt_count: 0,
        issued_at: input.now,
        due_at: dueAt,
        metadata_json: { tax_rate: env.BILLING_TAX_RATE }
      })
      .execute();

    await trx
      .insertInto('subscription_invoice_items')
      .values(
        input.lines.map((line, index) => ({
          id: randomUUID(),
          tenant_id: input.tenantId,
          invoice_id: id,
          description: line.description,
          quantity: line.quantity ?? 1,
          unit_price_cents: line.unitPriceCents,
          amount_cents: Math.round(line.unitPriceCents * (line.quantity ?? 1)),
          sort_order: index
        }))
      )
      .execute();

    const invoice = await trx
      .selectFrom('subscription_invoices')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

    return { invoice, created: true };
  }

  static async registerAttempt(trx: Transaction<Database>, invoiceId: string, now: Date): Promise<number> {
    const row = await trx
      .updateTable('subscription_invoices')
      .set((eb) => ({ attempt_count: eb('attempt_count', '+', 1), updated_at: now }))
      .where('id', '=', invoiceId)
      .returning('attempt_count')
      .executeTakeFirstOrThrow();

    return row.attempt_count;
  }

  static async markPaid(
    trx: Transaction<Database>,
    invoiceId: string,
    paymentTransactionId: string | null,
    now: Date
  ): Promise<void> {
    await trx
      .updateTable('subscription_invoices')
      .set({ status: 'PAID', paid_at: now, payment_transaction_id: paymentTransactionId, updated_at: now })
      .where('id', '=', invoiceId)
      // Una factura ya pagada no se vuelve a pagar: si llegan el cobro directo y el webhook
      // de la misma transacción, el segundo no encuentra nada que actualizar.
      .where('status', '=', 'OPEN')
      .execute();
  }

  static async markUncollectible(trx: Transaction<Database>, invoiceId: string, now: Date): Promise<void> {
    await trx
      .updateTable('subscription_invoices')
      .set({ status: 'UNCOLLECTIBLE', updated_at: now })
      .where('id', '=', invoiceId)
      .where('status', '=', 'OPEN')
      .execute();
  }

  /** Histórico para el portal del comercio, con sus líneas. */
  static async history(trx: Transaction<Database>, tenantId: string, limit = 24): Promise<SubscriptionInvoice[]> {
    const invoices = await trx
      .selectFrom('subscription_invoices')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('issued_at', 'desc')
      .limit(limit)
      .execute();

    if (invoices.length === 0) return [];

    const items = await trx
      .selectFrom('subscription_invoice_items')
      .selectAll()
      .where(
        'invoice_id',
        'in',
        invoices.map((invoice) => invoice.id)
      )
      .orderBy('sort_order', 'asc')
      .execute();

    return invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status as SubscriptionInvoice['status'],
      plan_id: invoice.plan_id,
      plan_name: invoice.plan_name,
      billing_cycle: invoice.billing_cycle,
      period_start: invoice.period_start.toISOString(),
      period_end: invoice.period_end.toISOString(),
      subtotal_cents: invoice.subtotal_cents,
      discount_cents: invoice.discount_cents,
      tax_cents: invoice.tax_cents,
      total_cents: invoice.total_cents,
      currency: invoice.currency,
      coupon_code: invoice.coupon_code,
      issued_at: invoice.issued_at.toISOString(),
      due_at: invoice.due_at ? invoice.due_at.toISOString() : null,
      paid_at: invoice.paid_at ? invoice.paid_at.toISOString() : null,
      attempt_count: invoice.attempt_count,
      items: items
        .filter((item) => item.invoice_id === invoice.id)
        .map((item) => ({
          id: item.id,
          description: item.description,
          quantity: Number(item.quantity),
          unit_price_cents: item.unit_price_cents,
          amount_cents: item.amount_cents
        }))
    }));
  }

  /**
   * Canjea un cupón para el comercio. El índice único sobre `(tenant_id, coupon_code)` es
   * lo que impide que un `REPEATING` de tres periodos se vuelva perpetuo canjeándolo otra
   * vez cada vez que se agota.
   */
  static async redeemCoupon(
    trx: Transaction<Database>,
    tenantId: string,
    code: string,
    now: Date
  ): Promise<{ ok: true; periods: number | null } | { ok: false; reason: string }> {
    const coupon = await trx
      .selectFrom('billing_coupons')
      .selectAll()
      .where('code', '=', code)
      .executeTakeFirst();

    if (!coupon || !coupon.active) return { ok: false, reason: 'El cupón no existe o ya no está vigente' };
    if (coupon.valid_from && coupon.valid_from > now) return { ok: false, reason: 'El cupón todavía no está vigente' };
    if (coupon.valid_until && coupon.valid_until < now) return { ok: false, reason: 'El cupón ya venció' };
    if (coupon.max_redemptions !== null && coupon.redeemed_count >= coupon.max_redemptions) {
      return { ok: false, reason: 'El cupón alcanzó su número máximo de canjes' };
    }

    const already = await trx
      .selectFrom('tenant_coupon_redemptions')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('coupon_code', '=', code)
      .executeTakeFirst();

    if (already) return { ok: false, reason: 'Este cupón ya fue aplicado en tu cuenta' };

    await trx
      .insertInto('tenant_coupon_redemptions')
      .values({ id: randomUUID(), tenant_id: tenantId, coupon_code: code, redeemed_at: now })
      .execute();

    // El contador global es catálogo, no lleva RLS, y se incrementa con la fila delante
    // para que dos canjes simultáneos no se pisen.
    await sql`
      UPDATE billing_coupons SET redeemed_count = redeemed_count + 1 WHERE code = ${code}
    `.execute(trx);

    const periods =
      coupon.duration === 'FOREVER' ? null : coupon.duration === 'REPEATING' ? (coupon.duration_periods ?? 1) : 1;

    return { ok: true, periods };
  }
}
