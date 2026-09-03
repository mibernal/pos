import type { Transaction } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import type { PaymentKind } from '@pos-dian/shared';
import type { SalePaymentRow } from '../domain/cash-sessions-service.js';

export interface ShiftPayments {
  payments: SalePaymentRow[];
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

  return {
    payments: payments.map((row) => ({
      method_code: row.method_code,
      kind: row.kind as PaymentKind,
      label: row.label,
      amount_cents: row.amount_cents,
      tendered_cents: row.tendered_cents,
      change_cents: row.change_cents
    })),
    salesCount: Number(totals.count),
    salesTotalCents: Number(totals.total)
  };
}
