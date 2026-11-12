import { z } from 'zod';

/**
 * Contrato de la facturación recurrente, compartido entre API y frontend.
 *
 * Hasta la fase 7 el cobro era una pantalla de checkout y un motor de renovación con los
 * cobros comentados. Lo que falta aquí no es una integración más: es el vocabulario común
 * —factura, intento, paso de cobranza— sin el cual cada lado se inventa el suyo.
 */

/* ------------------------------------------------------------------ *
 * Facturas de la suscripción
 * ------------------------------------------------------------------ */

/**
 * Estados de la factura del SaaS. `UNCOLLECTIBLE` es el final honesto de una factura que
 * agotó la cobranza: ni pagada ni anulada, porque anularla borraría que se intentó.
 */
export const INVOICE_STATUSES = ['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Borrador',
  OPEN: 'Pendiente',
  PAID: 'Pagada',
  VOID: 'Anulada',
  UNCOLLECTIBLE: 'Incobrable'
};

export const invoiceItemSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  unit_price_cents: z.number().int(),
  amount_cents: z.number().int()
});
export type InvoiceItem = z.infer<typeof invoiceItemSchema>;

export const subscriptionInvoiceSchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  status: z.enum(INVOICE_STATUSES),
  plan_id: z.string(),
  plan_name: z.string(),
  billing_cycle: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  subtotal_cents: z.number().int(),
  discount_cents: z.number().int(),
  tax_cents: z.number().int(),
  total_cents: z.number().int(),
  currency: z.string(),
  coupon_code: z.string().nullable(),
  issued_at: z.string(),
  due_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  attempt_count: z.number().int(),
  items: z.array(invoiceItemSchema).default([])
});
export type SubscriptionInvoice = z.infer<typeof subscriptionInvoiceSchema>;

/* ------------------------------------------------------------------ *
 * Métodos de pago tokenizados
 * ------------------------------------------------------------------ */

export const PAYMENT_METHOD_STATUSES = ['ACTIVE', 'EXPIRED', 'REMOVED'] as const;
export type PaymentMethodStatus = (typeof PAYMENT_METHOD_STATUSES)[number];

/**
 * Lo que se guarda de una tarjeta. Nunca el número: la pasarela devuelve un token que solo
 * sirve para cobrar desde nuestra cuenta, y los cuatro últimos dígitos son para que el
 * comercio reconozca cuál es.
 */
export const paymentMethodSchema = z.object({
  id: z.string().uuid(),
  gateway: z.string(),
  brand: z.string().nullable(),
  last_four: z.string().nullable(),
  exp_month: z.number().int().nullable(),
  exp_year: z.number().int().nullable(),
  holder_name: z.string().nullable(),
  status: z.enum(PAYMENT_METHOD_STATUSES),
  is_default: z.boolean(),
  created_at: z.string()
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/**
 * La tokenización de la tarjeta la hace el navegador contra la pasarela con la llave
 * pública: el número no pasa por nuestros servidores en ningún momento. Lo que llega aquí
 * es el token de un solo uso más el token de aceptación de los términos, que la pasarela
 * exige para poder cobrar sin el tarjetahabiente presente.
 */
export const registerPaymentMethodSchema = z.object({
  gateway: z.enum(['WOMPI', 'MOCK']).default('WOMPI'),
  card_token: z.string().min(1),
  acceptance_token: z.string().min(1),
  customer_email: z.string().email().optional(),
  make_default: z.boolean().default(true)
});
export type RegisterPaymentMethodInput = z.infer<typeof registerPaymentMethodSchema>;

/* ------------------------------------------------------------------ *
 * Cobranza (dunning)
 * ------------------------------------------------------------------ */

/**
 * Los pasos por los que pasa un cobro, en orden. Se guardan como rastro para poder
 * responder «¿por qué está suspendido este comercio?» sin leer logs, y para que cada aviso
 * se envíe una sola vez aunque el scheduler corra dos veces.
 */
export const DUNNING_STEPS = [
  'NOTICE_7',
  'NOTICE_3',
  'CHARGE_ATTEMPTED',
  'CHARGE_PENDING',
  'CHARGE_SUCCEEDED',
  'CHARGE_FAILED',
  'RETRY_SCHEDULED',
  'GRACE_STARTED',
  'DEGRADED',
  'SUSPENDED',
  'RECOVERED',
  'GIVEN_UP'
] as const;
export type DunningStep = (typeof DUNNING_STEPS)[number];

export const DUNNING_STEP_LABELS: Record<DunningStep, string> = {
  NOTICE_7: 'Aviso 7 días antes',
  NOTICE_3: 'Aviso 3 días antes',
  CHARGE_ATTEMPTED: 'Cobro intentado',
  CHARGE_PENDING: 'Cobro en curso',
  CHARGE_SUCCEEDED: 'Cobro aprobado',
  CHARGE_FAILED: 'Cobro rechazado',
  RETRY_SCHEDULED: 'Reintento programado',
  GRACE_STARTED: 'Periodo de gracia',
  DEGRADED: 'Servicio degradado',
  SUSPENDED: 'Suscripción suspendida',
  RECOVERED: 'Cobro recuperado',
  GIVEN_UP: 'Cobranza agotada'
};

export const dunningEventSchema = z.object({
  id: z.string().uuid(),
  step: z.enum(DUNNING_STEPS),
  attempt: z.number().int(),
  detail: z.string().nullable(),
  occurred_at: z.string()
});
export type DunningEvent = z.infer<typeof dunningEventSchema>;

/* ------------------------------------------------------------------ *
 * Cupones
 * ------------------------------------------------------------------ */

export const COUPON_TYPES = ['PERCENT', 'FIXED'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

/**
 * Cuánto dura el descuento. `ONCE` es el cupón de bienvenida, `REPEATING` la promoción de
 * N periodos, `FOREVER` la cortesía permanente que se le concede a un cliente ancla.
 */
export const COUPON_DURATIONS = ['ONCE', 'REPEATING', 'FOREVER'] as const;
export type CouponDuration = (typeof COUPON_DURATIONS)[number];

export const couponSchema = z.object({
  code: z.string(),
  description: z.string().nullable(),
  type: z.enum(COUPON_TYPES),
  value: z.number(),
  duration: z.enum(COUPON_DURATIONS),
  duration_periods: z.number().int().nullable(),
  max_redemptions: z.number().int().nullable(),
  redeemed_count: z.number().int(),
  valid_from: z.string().nullable(),
  valid_until: z.string().nullable(),
  active: z.boolean()
});
export type Coupon = z.infer<typeof couponSchema>;

export const upsertCouponSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[A-Z0-9_-]+$/, 'Solo mayúsculas, números, guion y guion bajo'),
  description: z.string().max(200).optional(),
  type: z.enum(COUPON_TYPES),
  /** Porcentaje 1–100 para `PERCENT`; centavos para `FIXED`. */
  value: z.number().positive(),
  duration: z.enum(COUPON_DURATIONS).default('ONCE'),
  duration_periods: z.number().int().positive().optional(),
  max_redemptions: z.number().int().positive().optional(),
  valid_from: z.string().datetime().optional(),
  valid_until: z.string().datetime().optional(),
  active: z.boolean().default(true)
});
export type UpsertCouponInput = z.infer<typeof upsertCouponSchema>;

/* ------------------------------------------------------------------ *
 * Cálculo del importe
 * ------------------------------------------------------------------ */

/**
 * IVA colombiano sobre el servicio de software. Se guarda desglosado en la factura, no
 * incluido en el precio, porque el comercio lo descuenta y necesita verlo aparte.
 */
export const DEFAULT_TAX_RATE = 0.19;

export interface InvoiceAmounts {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

/**
 * Un solo lugar donde se decide cuánto se cobra.
 *
 * El descuento se aplica antes del impuesto —que es como lo pide la DIAN y como lo espera
 * cualquier contador— y todo se redondea a centavo entero: un `total_cents` con decimales
 * es una diferencia de un peso entre lo que dice la factura y lo que cobra la pasarela.
 */
export function computeInvoiceAmounts(
  subtotalCents: number,
  discount: { type: CouponType; value: number } | null,
  taxRate: number = DEFAULT_TAX_RATE
): InvoiceAmounts {
  const subtotal = Math.max(0, Math.round(subtotalCents));

  let discountCents = 0;
  if (discount) {
    discountCents =
      discount.type === 'PERCENT'
        ? Math.round((subtotal * Math.min(100, Math.max(0, discount.value))) / 100)
        : Math.round(discount.value);
  }
  discountCents = Math.min(discountCents, subtotal);

  const taxable = subtotal - discountCents;
  const taxCents = Math.round(taxable * taxRate);

  return {
    subtotalCents: subtotal,
    discountCents,
    taxCents,
    totalCents: taxable + taxCents
  };
}

/**
 * Espera entre reintentos, en horas: 24 h, 72 h, 168 h (una semana).
 *
 * Crece a propósito. Un rechazo por fondos insuficientes se resuelve solo cuando entra la
 * nómina, no en la hora siguiente; reintentar cada hora solo consigue que el banco marque
 * la tarjeta y que el comercio reciba seis correos.
 */
export const RETRY_BACKOFF_HOURS = [24, 72, 168] as const;

export function retryDelayHours(attempt: number): number {
  const index = Math.max(0, Math.min(attempt, RETRY_BACKOFF_HOURS.length - 1));
  // El `?? 24` no es defensivo por gusto: con `noUncheckedIndexedAccess` el acceso por
  // índice es `number | undefined`, y un reintento sin espera sería un bucle de cobros.
  return RETRY_BACKOFF_HOURS[index] ?? 24;
}

/* ------------------------------------------------------------------ *
 * Portal de facturación e ingresos
 * ------------------------------------------------------------------ */

export const billingPortalSchema = z.object({
  subscription: z.object({
    id: z.string().uuid(),
    plan_id: z.string(),
    plan_name: z.string(),
    price_cents: z.number().int(),
    billing_cycle: z.string(),
    status: z.string(),
    service_level: z.string(),
    auto_renew: z.boolean(),
    current_period_start: z.string().nullable(),
    current_period_end: z.string().nullable(),
    next_billing_at: z.string().nullable(),
    trial_ends_at: z.string().nullable(),
    cancelled_at: z.string().nullable(),
    coupon_code: z.string().nullable(),
    retry_count: z.number().int(),
    max_retries: z.number().int(),
    next_retry_at: z.string().nullable()
  }),
  usage: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      used: z.number(),
      limit: z.number(),
      enforced: z.boolean()
    })
  ),
  payment_method: paymentMethodSchema.nullable(),
  invoices: z.array(subscriptionInvoiceSchema),
  dunning: z.array(dunningEventSchema)
});
export type BillingPortal = z.infer<typeof billingPortalSchema>;

export const revenueMetricsSchema = z.object({
  mrr_cents: z.number().int(),
  arr_cents: z.number().int(),
  arpa_cents: z.number().int(),
  active_subscriptions: z.number().int(),
  trial_subscriptions: z.number().int(),
  past_due_subscriptions: z.number().int(),
  churn_rate: z.number(),
  churned_last_30d: z.number().int(),
  new_last_30d: z.number().int(),
  collected_last_30d_cents: z.number().int(),
  failed_last_30d_cents: z.number().int(),
  by_plan: z.array(
    z.object({
      plan_id: z.string(),
      plan_name: z.string(),
      subscriptions: z.number().int(),
      mrr_cents: z.number().int()
    })
  )
});
export type RevenueMetrics = z.infer<typeof revenueMetricsSchema>;

/**
 * Normaliza cualquier ciclo a su aporte mensual, para que el MRR sume peras con peras.
 *
 * El panel anterior sumaba `price_cents` de todo lo activo y llamaba a eso MRR: un plan
 * anual de $2.400.000 contaba como si entraran $2.400.000 todos los meses.
 */
export function monthlyRecurringCents(priceCents: number, billingCycle: string): number {
  return billingCycle === 'YEARLY' ? Math.round(priceCents / 12) : priceCents;
}
