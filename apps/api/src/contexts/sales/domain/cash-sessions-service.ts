import { PAYMENT_KIND_BEHAVIOR, summarizePayments, type PaymentKind, type ShiftPaymentSummary } from '@pos-dian/shared';

/**
 * El efectivo esperado de un turno.
 *
 * Lo que había aquí era una función que **adivinaba** cuánto efectivo había entrado
 * recorriendo quince rutas posibles dentro de `sales.payment_json` —`cash_cents`,
 * `cash.amount_cents`, `amounts.cashAmountCents`, `breakdown.cash_cents`…— y que, si no
 * encontraba ninguna, miraba si la palabra del método era «cash» y en ese caso daba por
 * efectivo el total entero de la venta.
 *
 * Esa lista no era paranoia: era el fósil de un formato que cambió varias veces sin migrar
 * lo anterior. Pero adivinar el dinero de un arqueo es la peor forma posible de calcularlo,
 * porque cuando acierta nadie lo comprueba y cuando falla el cajero se come la diferencia.
 *
 * Desde la migración 099 los pagos son filas con su tipo, así que aquí solo hay una suma.
 */

interface CashMovementSnapshot {
  type: 'IN' | 'OUT';
  amount_cents: number;
}

export interface SalePaymentRow {
  method_code: string;
  kind: PaymentKind;
  label?: string | null;
  amount_cents: number;
  tendered_cents?: number | null;
  change_cents?: number | null;
}

/**
 * Cuánto de este pago está en el cajón.
 *
 * El vuelto no se resta aparte: `amount_cents` es lo aplicado a la venta, ya neto de lo
 * devuelto. Restarlo otra vez sería contarlo dos veces, que es el error clásico al modelar
 * el recibido y el cambio.
 */
export function cashDrawerImpactCents(payment: SalePaymentRow): number {
  return PAYMENT_KIND_BEHAVIOR[payment.kind].affectsCashDrawer ? payment.amount_cents : 0;
}

export function calculateExpectedCashCents(
  openingAmountCents: number,
  payments: ReadonlyArray<SalePaymentRow>,
  cashMovements: ReadonlyArray<CashMovementSnapshot> = []
): number {
  let expectedCashCents = openingAmountCents;

  for (const payment of payments) {
    expectedCashCents += cashDrawerImpactCents(payment);
  }

  for (const movement of cashMovements) {
    if (movement.type === 'IN') {
      expectedCashCents += movement.amount_cents;
    } else {
      expectedCashCents -= movement.amount_cents;
    }
  }

  return expectedCashCents;
}

export function calculateDiffCents(expectedCashCents: number, closingCashRealCents: number): number {
  return closingCashRealCents - expectedCashCents;
}

/**
 * Desglose del turno por medio de pago, agrupado por lo que le hace al dinero.
 *
 * Sustituye al objeto literal de tres claves que construía el cierre de caja, donde un
 * `if (methodRevenues[method] !== undefined)` descartaba en silencio cualquier medio que no
 * fuera efectivo, tarjeta o transferencia.
 */
export function buildShiftPaymentSummary(payments: ReadonlyArray<SalePaymentRow>): ShiftPaymentSummary {
  return summarizePayments(payments);
}
