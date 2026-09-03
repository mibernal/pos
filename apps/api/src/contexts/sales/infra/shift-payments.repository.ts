import type { Transaction } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import type { PaymentKind } from '@pos-dian/shared';
import type { SalePaymentRow } from '../domain/cash-sessions-service.js';

export interface ShiftPayments {
  payments: SalePaymentRow[];
  /** Lo que entró por abonos a fiados, aparte de lo vendido en el turno. */
  receivablePaymentsCents: number;
  /** Ventas completadas del turno. No es lo mismo que el número de pagos: una venta mixta
   *  tiene varios, y contar pagos como ventas inflaba el Z. */
  salesCount: number;
  salesTotalCents: number;
}

/**
 * Los pagos de un turno, ya con su etiqueta del catálogo.
 *
 * Una sola consulta para las tres cosas que necesitaba el cierre —efectivo esperado,
 * desglose por medio y total vendido— que antes se calculaban por separado leyendo el mismo
 * JSON con criterios distintos.
 */
export async function loadShiftPayments(
  trx: Transaction<Database>,
  input: { tenantId: string; cashSessionId: string }
): Promise<ShiftPayments> {
  const payments = await trx
    .selectFrom('sale_payments as sp')
    .innerJoin('sales as s', 's.id', 'sp.sale_id')
    .leftJoin('payment_method_catalog as c', (join) =>
      join.onRef('c.tenant_id', '=', 'sp.tenant_id').onRef('c.code', '=', 'sp.method_code')
    )
    .select([
      'sp.method_code',
      'sp.kind',
      'sp.amount_cents',
      'sp.tendered_cents',
      'sp.change_cents',
      'c.label'
    ])
    .where('sp.tenant_id', '=', input.tenantId)
    .where('sp.cash_session_id', '=', input.cashSessionId)
    // Una venta anulada no aporta al arqueo: su dinero salió del cajón al devolverlo.
    .where('s.status', '=', 'COMPLETED')
    .execute();

  /**
   * Los abonos a cuentas por cobrar también entran al turno.
   *
   * Es el detalle que decide si el arqueo cuadra: un cliente que viene a pagar su fiado en
   * efectivo pone plata en el cajón sin que haya ninguna venta. Sin esta consulta el turno
   * cerraría con sobrante justo los días de cobro, y el cajero tendría que explicar un
   * dinero que el sistema no reconoce.
   */
  const abonos = await trx
    .selectFrom('customer_payments as cp')
    .leftJoin('payment_method_catalog as c', (join) =>
      join.onRef('c.tenant_id', '=', 'cp.tenant_id').onRef('c.code', '=', 'cp.method_code')
    )
    .select(['cp.method_code', 'cp.kind', 'cp.amount_cents', 'c.label'])
    .where('cp.tenant_id', '=', input.tenantId)
    .where('cp.cash_session_id', '=', input.cashSessionId)
    .execute();

  const totals = await trx
    .selectFrom('sales')
    .select((eb) => [
      eb.fn.count<number>('id').as('count'),
      eb.fn.coalesce(eb.fn.sum<number>('total_cents'), eb.lit(0)).as('total')
    ])
    .where('tenant_id', '=', input.tenantId)
    .where('cash_session_id', '=', input.cashSessionId)
    .where('status', '=', 'COMPLETED')
    .executeTakeFirstOrThrow();

  const filas: SalePaymentRow[] = payments.map((row) => ({
    method_code: row.method_code,
    kind: row.kind as PaymentKind,
    label: row.label,
    amount_cents: row.amount_cents,
    tendered_cents: row.tendered_cents,
    change_cents: row.change_cents
  }));

  for (const abono of abonos) {
    /**
     * El abono se agrupa bajo su propio código para que el Z lo muestre aparte de las
     * ventas. Mezclarlo con el efectivo de caja daría el mismo total del cajón —correcto—
     * pero haría imposible responder «¿cuánto vendí hoy?» sin restar a mano lo cobrado de
     * deudas viejas.
     */
    filas.push({
      method_code: `ABONO_${abono.method_code}`,
      kind: abono.kind as PaymentKind,
      label: `Abono · ${abono.label ?? abono.method_code}`,
      amount_cents: abono.amount_cents,
      tendered_cents: null,
      change_cents: null
    });
  }

  return {
    payments: filas,
    receivablePaymentsCents: abonos.reduce((suma, abono) => suma + abono.amount_cents, 0),
    salesCount: Number(totals.count),
    salesTotalCents: Number(totals.total)
  };
}
