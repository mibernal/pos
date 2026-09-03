import { z } from 'zod';

/**
 * Medios de pago de la caja.
 *
 * Hasta ahora eran tres —`CASH`, `CARD`, `TRANSFER`— y vivían dentro de un `payment_json`
 * sin estructura. Eso obligaba a dos cosas feas: que el cálculo del efectivo esperado
 * adivinara el importe recorriendo quince rutas posibles del JSON, y que el reporte Z
 * tuviera los tres métodos escritos a mano en un objeto literal, descartando en silencio
 * cualquier otro. Añadir un medio era tocar tres agregaciones que nadie sincroniza.
 *
 * Aquí el medio de pago deja de ser un nombre y pasa a ser un comportamiento: qué le hace
 * al cajón, si exige referencia, y si trae dinero ahora o lo promete para después. El
 * arqueo y el Z se derivan de eso, no de una lista.
 */

/* ------------------------------------------------------------------ *
 * Tipos de medio
 * ------------------------------------------------------------------ */

export const PAYMENT_KINDS = [
  'CASH',
  'CARD',
  'TRANSFER',
  /** Billeteras con QR: Nequi, Daviplata, Bre-B. */
  'WALLET',
  /** Bono o tarjeta de regalo emitida por el propio comercio. */
  'GIFT_CARD',
  /** Fiado: el comercio le presta al cliente y cobra después. */
  'STORE_CREDIT',
  /** Redención de puntos de fidelización. */
  'POINTS',
  /** Vales de alimentación y similares. */
  'VOUCHER'
] as const;

export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const paymentKindSchema = z.enum(PAYMENT_KINDS);

export interface PaymentKindBehavior {
  label: string;
  /**
   * Si el importe entra —o sale— del cajón de efectivo.
   *
   * Es la única propiedad que decide el efectivo esperado del arqueo. Antes esa decisión
   * la tomaba una función que buscaba la palabra «cash» dentro de un JSON.
   */
  affectsCashDrawer: boolean;
  /**
   * Si el dinero está disponible en el momento de la venta.
   *
   * `false` en fiado, bonos, puntos y vales: la venta se cierra, pero lo que entra no es
   * dinero de hoy. Sumarlos a lo recaudado del turno es la forma más común de cuadrar una
   * caja que en realidad no cuadra.
   */
  settlesNow: boolean;
  /** Si hace falta un identificador externo (aprobación, referencia, código del bono). */
  requiresReference: boolean;
  /** Cómo se agrupa en el reporte Z. */
  group: 'CASH' | 'ELECTRONIC' | 'DEFERRED';
}

export const PAYMENT_KIND_BEHAVIOR: Record<PaymentKind, PaymentKindBehavior> = {
  CASH: { label: 'Efectivo', affectsCashDrawer: true, settlesNow: true, requiresReference: false, group: 'CASH' },
  CARD: { label: 'Tarjeta', affectsCashDrawer: false, settlesNow: true, requiresReference: true, group: 'ELECTRONIC' },
  /**
   * Transferencia y billetera **no** exigen referencia por defecto, aunque tenerla sea
   * buena práctica. Exigirla aquí endurecería una validación que hoy no existe y dejaría
   * a un cajero sin poder cerrar una venta perfectamente válida a mitad de turno, como
   * efecto secundario de haber añadido medios nuevos. El comercio que quiera esa
   * disciplina la enciende en su catálogo, medio por medio.
   */
  TRANSFER: { label: 'Transferencia', affectsCashDrawer: false, settlesNow: true, requiresReference: false, group: 'ELECTRONIC' },
  WALLET: { label: 'Billetera digital', affectsCashDrawer: false, settlesNow: true, requiresReference: false, group: 'ELECTRONIC' },
  GIFT_CARD: { label: 'Bono / tarjeta regalo', affectsCashDrawer: false, settlesNow: false, requiresReference: true, group: 'DEFERRED' },
  STORE_CREDIT: { label: 'Crédito del cliente', affectsCashDrawer: false, settlesNow: false, requiresReference: false, group: 'DEFERRED' },
  POINTS: { label: 'Puntos', affectsCashDrawer: false, settlesNow: false, requiresReference: false, group: 'DEFERRED' },
  VOUCHER: { label: 'Vale', affectsCashDrawer: false, settlesNow: false, requiresReference: true, group: 'DEFERRED' }
};

export function affectsCashDrawer(kind: PaymentKind): boolean {
  return PAYMENT_KIND_BEHAVIOR[kind].affectsCashDrawer;
}

export const PAYMENT_GROUP_LABELS: Record<PaymentKindBehavior['group'], string> = {
  CASH: 'En el cajón',
  ELECTRONIC: 'Cobrado electrónicamente',
  DEFERRED: 'Sin entrada de dinero'
};

/* ------------------------------------------------------------------ *
 * Catálogo por comercio
 * ------------------------------------------------------------------ */

/**
 * Un comercio no cobra con «WALLET»: cobra con Nequi, o con Daviplata. El tipo dice cómo se
 * comporta el dinero; el catálogo dice cómo se llama y si está encendido, para que añadir
 * un medio sea una fila y no un despliegue.
 */
export const paymentMethodCatalogSchema = z.object({
  code: z.string(),
  kind: paymentKindSchema,
  label: z.string(),
  active: z.boolean(),
  requires_reference: z.boolean(),
  /** Orden en la pantalla de cobro. */
  sort_order: z.number().int(),
  /** Los del sistema no se pueden borrar: hay ventas históricas que los referencian. */
  is_system: z.boolean()
});
export type PaymentMethodCatalogEntry = z.infer<typeof paymentMethodCatalogSchema>;

export const upsertPaymentMethodSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[A-Z0-9_]+$/, 'Solo mayúsculas, números y guion bajo'),
  kind: paymentKindSchema,
  label: z.string().min(2).max(60),
  active: z.boolean().default(true),
  requires_reference: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(999).default(100)
});
export type UpsertPaymentMethodInput = z.infer<typeof upsertPaymentMethodSchema>;

/**
 * Medios que se siembran para todo comercio.
 *
 * Los tres primeros nacen encendidos porque son los que el sistema ya cobraba. Los demás
 * nacen apagados a propósito: encenderle a un comercio un medio que no usa le añade un
 * botón que confunde al cajero y una línea en el Z que siempre dice cero.
 */
export const DEFAULT_PAYMENT_METHODS: ReadonlyArray<{
  code: string;
  kind: PaymentKind;
  label: string;
  active: boolean;
  sort_order: number;
}> = [
  { code: 'CASH', kind: 'CASH', label: 'Efectivo', active: true, sort_order: 10 },
  { code: 'CARD', kind: 'CARD', label: 'Tarjeta', active: true, sort_order: 20 },
  { code: 'TRANSFER', kind: 'TRANSFER', label: 'Transferencia', active: true, sort_order: 30 },
  { code: 'NEQUI', kind: 'WALLET', label: 'Nequi', active: false, sort_order: 40 },
  { code: 'DAVIPLATA', kind: 'WALLET', label: 'Daviplata', active: false, sort_order: 50 },
  { code: 'BRE_B', kind: 'WALLET', label: 'Bre-B', active: false, sort_order: 60 },
  { code: 'GIFT_CARD', kind: 'GIFT_CARD', label: 'Bono regalo', active: false, sort_order: 70 },
  { code: 'STORE_CREDIT', kind: 'STORE_CREDIT', label: 'Fiado', active: false, sort_order: 80 },
  { code: 'POINTS', kind: 'POINTS', label: 'Puntos', active: false, sort_order: 90 },
  { code: 'VOUCHER', kind: 'VOUCHER', label: 'Vale', active: false, sort_order: 100 }
];

/* ------------------------------------------------------------------ *
 * Desglose del turno
 * ------------------------------------------------------------------ */

export const paymentBreakdownRowSchema = z.object({
  code: z.string(),
  kind: paymentKindSchema,
  label: z.string(),
  group: z.enum(['CASH', 'ELECTRONIC', 'DEFERRED']),
  amount_cents: z.number().int(),
  count: z.number().int()
});
export type PaymentBreakdownRow = z.infer<typeof paymentBreakdownRowSchema>;

export const shiftPaymentSummarySchema = z.object({
  rows: z.array(paymentBreakdownRowSchema),
  cash_cents: z.number().int(),
  electronic_cents: z.number().int(),
  deferred_cents: z.number().int(),
  /** Efectivo entregado por los clientes y vuelto devuelto, para poder explicar el cajón. */
  tendered_cents: z.number().int(),
  change_cents: z.number().int(),
  total_cents: z.number().int()
});
export type ShiftPaymentSummary = z.infer<typeof shiftPaymentSummarySchema>;

/**
 * Agrupa filas de pago en el desglose del turno.
 *
 * Vive en el paquete compartido para que el Z del backend y la pantalla de cierre del
 * frontend no puedan discrepar: eran dos sumas escritas por separado sobre el mismo JSON.
 */
export function summarizePayments(
  payments: ReadonlyArray<{
    method_code: string;
    kind: PaymentKind;
    label?: string | null;
    amount_cents: number;
    tendered_cents?: number | null;
    change_cents?: number | null;
  }>
): ShiftPaymentSummary {
  const byCode = new Map<string, PaymentBreakdownRow>();
  let cash = 0;
  let electronic = 0;
  let deferred = 0;
  let tendered = 0;
  let change = 0;

  for (const payment of payments) {
    const behavior = PAYMENT_KIND_BEHAVIOR[payment.kind];

    const row = byCode.get(payment.method_code) ?? {
      code: payment.method_code,
      kind: payment.kind,
      label: payment.label ?? behavior.label,
      group: behavior.group,
      amount_cents: 0,
      count: 0
    };

    row.amount_cents += payment.amount_cents;
    row.count += 1;
    byCode.set(payment.method_code, row);

    if (behavior.group === 'CASH') cash += payment.amount_cents;
    else if (behavior.group === 'ELECTRONIC') electronic += payment.amount_cents;
    else deferred += payment.amount_cents;

    tendered += payment.tendered_cents ?? 0;
    change += payment.change_cents ?? 0;
  }

  return {
    rows: [...byCode.values()].sort((a, b) => b.amount_cents - a.amount_cents),
    cash_cents: cash,
    electronic_cents: electronic,
    deferred_cents: deferred,
    tendered_cents: tendered,
    change_cents: change,
    total_cents: cash + electronic + deferred
  };
}
