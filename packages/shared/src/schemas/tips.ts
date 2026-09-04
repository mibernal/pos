import { z } from 'zod';

/**
 * Liquidación de propinas.
 *
 * `tip_cents` existía desde hace tiempo y su único lector era un `SUM` del informe de
 * meseros. Lo que faltaba es todo lo que viene después de cobrarla: repartirla, distinguir
 * la que está en el cajón de la que cobró el comercio con tarjeta, y pagarla dejando el
 * movimiento de caja correspondiente.
 */

export const TIP_POLICIES = ['INDIVIDUAL', 'POOL'] as const;
export type TipPolicy = (typeof TIP_POLICIES)[number];

export const TIP_POLICY_LABELS: Record<TipPolicy, string> = {
  INDIVIDUAL: 'Cada mesero se lleva la suya',
  POOL: 'Bolsa común, repartida por partes iguales'
};

export const tipSettingsSchema = z.object({
  policy: z.enum(TIP_POLICIES).default('INDIVIDUAL'),
  /**
   * Liquidar al cerrar el turno. Apagado por defecto: pagar propinas mueve dinero y no
   * debería ocurrir como efecto secundario de cerrar la caja.
   */
  auto_settle_on_close: z.boolean().default(false)
});
export type TipSettings = z.infer<typeof tipSettingsSchema>;

export const tipShareSchema = z.object({
  waiter_id: z.string().uuid().nullable(),
  waiter_name: z.string(),
  sales_count: z.number().int(),
  earned_cents: z.number().int(),
  /** Lo que está en el cajón y sale de él al pagarlo. */
  cash_cents: z.number().int(),
  /** Lo cobrado con tarjeta o billetera: el comercio lo tiene y se lo debe al mesero. */
  electronic_cents: z.number().int()
});
export type TipShare = z.infer<typeof tipShareSchema>;

export const tipSummarySchema = z.object({
  policy: z.enum(TIP_POLICIES),
  total_cents: z.number().int(),
  cash_cents: z.number().int(),
  electronic_cents: z.number().int(),
  shares: z.array(tipShareSchema),
  settled: z.boolean(),
  settled_at: z.string().nullable()
});
export type TipSummary = z.infer<typeof tipSummarySchema>;

export const settleTipsSchema = z.object({
  /**
   * Si el pago en efectivo sale del cajón ahora. Cuando es `false` la propina queda
   * liquidada y pendiente de entregar, que es lo que hace un comercio que paga las propinas
   * con la nómina en vez de en el momento.
   */
  pay_cash_now: z.boolean().default(true),
  notes: z.string().max(300).optional()
});
export type SettleTipsInput = z.infer<typeof settleTipsSchema>;

/**
 * Reparte una bolsa común en partes iguales, sin perder centavos.
 *
 * Dividir y redondear hacia abajo deja pesos sin asignar en casi cada reparto; aquí el
 * sobrante se distribuye de uno en uno entre los primeros, que es como se reparte una bolsa
 * de propinas en la práctica y hace que la suma de las partes sea exactamente el total.
 */
export function splitPool(totalCents: number, participants: number): number[] {
  if (participants <= 0) return [];

  const base = Math.floor(totalCents / participants);
  const sobrante = totalCents - base * participants;

  return Array.from({ length: participants }, (_, index) => base + (index < sobrante ? 1 : 0));
}

/**
 * Reparte la propina de una venta entre sus medios de pago, en proporción a lo que pagó
 * cada uno.
 *
 * La propina viaja dentro del importe cobrado, así que en una venta mixta hay que decidir
 * qué parte llegó en efectivo: una cuenta de 100 con 20 de propina pagada mitad y mitad
 * deja 10 en el cajón y 10 en la tarjeta.
 *
 * Es una convención, no una verdad —el cliente no dijo con qué medio dejaba la propina—
 * pero es la única que reparte sin inventar, y sobre todo es **una sola**, escrita en un
 * sitio, en vez de que cada informe suponga la suya. El resto del redondeo va al pago mayor
 * para que la suma de las partes sea exactamente la propina.
 */
export function allocateTip(amountsCents: ReadonlyArray<number>, tipCents: number): number[] {
  if (tipCents <= 0 || amountsCents.length === 0) return amountsCents.map(() => 0);

  const total = amountsCents.reduce((suma, importe) => suma + importe, 0);
  if (total <= 0) return amountsCents.map(() => 0);

  const partes = amountsCents.map((importe) => Math.min(importe, Math.floor((tipCents * importe) / total)));
  const asignado = partes.reduce((suma, parte) => suma + parte, 0);
  let resto = tipCents - asignado;

  // El sobrante se coloca de mayor a menor, sin pasarse nunca del importe de cada pago.
  const orden = amountsCents
    .map((importe, indice) => ({ importe, indice }))
    .sort((a, b) => b.importe - a.importe);

  for (const { indice, importe } of orden) {
    if (resto <= 0) break;
    const cabe = Math.min(resto, importe - partes[indice]!);
    partes[indice] = partes[indice]! + cabe;
    resto -= cabe;
  }

  return partes;
}
