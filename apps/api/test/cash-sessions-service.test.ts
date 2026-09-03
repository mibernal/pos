import { describe, expect, it } from 'vitest';
import {
  buildShiftPaymentSummary,
  calculateDiffCents,
  calculateExpectedCashCents,
  cashDrawerImpactCents,
  type SalePaymentRow
} from '../src/contexts/sales/domain/cash-sessions-service.js';

/**
 * El efectivo esperado de un turno.
 *
 * Lo que se probaba antes era la función que **adivinaba** el efectivo recorriendo quince
 * rutas posibles del `payment_json` (`cash_cents`, `cash.amount_cents`,
 * `amounts.cashAmountCents`…). Esas pruebas pasaban y aun así el arqueo podía estar mal:
 * comprobaban que el adivinador adivinaba, no que la caja cuadrara.
 *
 * Ahora los pagos son filas con su tipo, y lo que hay que fijar es cuál de esos tipos toca
 * el cajón. Que es donde estaba el error de verdad.
 */

function pago(row: Partial<SalePaymentRow> & Pick<SalePaymentRow, 'kind' | 'amount_cents'>): SalePaymentRow {
  return {
    method_code: row.method_code ?? row.kind,
    label: row.label ?? null,
    tendered_cents: row.tendered_cents ?? null,
    change_cents: row.change_cents ?? null,
    ...row
  };
}

describe('efectivo esperado del turno', () => {
  it('solo el efectivo entra al cajón', () => {
    expect(cashDrawerImpactCents(pago({ kind: 'CASH', amount_cents: 15000 }))).toBe(15000);
    expect(cashDrawerImpactCents(pago({ kind: 'CARD', amount_cents: 15000 }))).toBe(0);
    expect(cashDrawerImpactCents(pago({ kind: 'WALLET', amount_cents: 15000 }))).toBe(0);
  });

  it('un fiado no pone dinero en el cajón', () => {
    // Es el error que más descuadra una caja: contar como recaudado algo que nadie pagó.
    expect(cashDrawerImpactCents(pago({ kind: 'STORE_CREDIT', amount_cents: 40000 }))).toBe(0);
    expect(cashDrawerImpactCents(pago({ kind: 'GIFT_CARD', amount_cents: 40000 }))).toBe(0);
    expect(cashDrawerImpactCents(pago({ kind: 'POINTS', amount_cents: 40000 }))).toBe(0);
  });

  it('el vuelto no se resta dos veces', () => {
    /**
     * El cliente entrega 50.000 por una cuenta de 32.400 y se lleva 17.600. En el cajón
     * quedan 32.400, no 50.000 ni 14.800: `amount_cents` ya es lo aplicado a la venta.
     */
    const conVuelto = pago({
      kind: 'CASH',
      amount_cents: 32400,
      tendered_cents: 50000,
      change_cents: 17600
    });

    expect(cashDrawerImpactCents(conVuelto)).toBe(32400);
    expect(calculateExpectedCashCents(20000, [conVuelto])).toBe(52400);
  });

  it('suma apertura, efectivo cobrado y movimientos de caja', () => {
    const esperado = calculateExpectedCashCents(
      20000,
      [
        pago({ kind: 'CASH', amount_cents: 15000 }),
        pago({ kind: 'CARD', amount_cents: 22000 }),
        pago({ kind: 'CASH', amount_cents: 5000 })
      ],
      [
        { type: 'IN', amount_cents: 3000 },
        { type: 'OUT', amount_cents: 8000 }
      ]
    );

    expect(esperado).toBe(20000 + 15000 + 5000 + 3000 - 8000);
  });

  it('la diferencia es lo real menos lo esperado', () => {
    expect(calculateDiffCents(40000, 39500)).toBe(-500);
    expect(calculateDiffCents(40000, 40000)).toBe(0);
  });
});

describe('desglose del turno', () => {
  it('separa lo que está en el cajón, lo cobrado y lo que no trajo dinero', () => {
    const resumen = buildShiftPaymentSummary([
      pago({ kind: 'CASH', amount_cents: 30000, tendered_cents: 50000, change_cents: 20000 }),
      pago({ kind: 'CARD', method_code: 'CARD', amount_cents: 25000 }),
      pago({ kind: 'WALLET', method_code: 'NEQUI', label: 'Nequi', amount_cents: 12000 }),
      pago({ kind: 'STORE_CREDIT', amount_cents: 18000 })
    ]);

    expect(resumen.cash_cents).toBe(30000);
    expect(resumen.electronic_cents).toBe(37000);
    expect(resumen.deferred_cents).toBe(18000);
    expect(resumen.total_cents).toBe(85000);

    // Lo entregado y el vuelto se conservan aparte, para poder explicar el cajón.
    expect(resumen.tendered_cents).toBe(50000);
    expect(resumen.change_cents).toBe(20000);
  });

  it('un medio nuevo aparece en el desglose sin tocar código', () => {
    /**
     * Es la regresión que justifica toda la migración: el desglose anterior era un objeto
     * literal de tres claves con un `if (methodRevenues[method] !== undefined)`, así que
     * Nequi se descartaba en silencio y el Z cuadraba de menos.
     */
    const resumen = buildShiftPaymentSummary([
      pago({ kind: 'WALLET', method_code: 'NEQUI', label: 'Nequi', amount_cents: 12000 }),
      pago({ kind: 'WALLET', method_code: 'DAVIPLATA', label: 'Daviplata', amount_cents: 8000 })
    ]);

    expect(resumen.rows.map((fila) => fila.code)).toEqual(['NEQUI', 'DAVIPLATA']);
    expect(resumen.rows[0]!.label).toBe('Nequi');
    expect(resumen.electronic_cents).toBe(20000);
  });

  it('agrupa varios pagos del mismo medio en una fila', () => {
    const resumen = buildShiftPaymentSummary([
      pago({ kind: 'CASH', amount_cents: 10000 }),
      pago({ kind: 'CASH', amount_cents: 5000 })
    ]);

    expect(resumen.rows).toHaveLength(1);
    expect(resumen.rows[0]!.amount_cents).toBe(15000);
    expect(resumen.rows[0]!.count).toBe(2);
  });
});
