import type { Insertable } from 'kysely';
import { z } from 'zod';
import { salePaymentJsonSchema, saleTaxLineSchema } from '@pos-dian/shared';
import type { Database } from '../../../shared/infra/db/schema.js';

const taxLinesSchema = z.array(saleTaxLineSchema);

export const saleColumnList = [
  'id',
  'tenant_id',
  'customer_id',
  'branch_id',
  'cash_session_id',
  'table_order_id',
  'sale_number',
  'status',
  'subtotal_cents',
  'discount_cents',
  'tip_cents',
  'total_cents',
  'tax_total_cents',
  'tax_lines_json',
  'payment_json',
  'created_by_user_id',
  'void_reason',
  'voided_by_user_id',
  'voided_at',
  'created_at'
] as const;

export function parseSaleNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return 0;
}

export function serializeJsonArrayForDb(
  value: ReadonlyArray<unknown>
): Insertable<Database['sales']>['tax_lines_json'] {
  // pg serializes JS arrays as PostgreSQL arrays, not JSON. We stringify before insert.
  return JSON.stringify(value) as unknown as Insertable<Database['sales']>['tax_lines_json'];
}

export function mapSaleRow(row: {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  branch_id: string;
  cash_session_id: string;
  table_order_id: string | null;
  sale_number: number;
  status: 'COMPLETED' | 'VOID';
  subtotal_cents: number;
  discount_cents: number;
  tip_cents: number;
  total_cents: number;
  tax_total_cents: number;
  tax_lines_json: unknown;
  payment_json: unknown;
  created_by_user_id: string;
  void_reason: string | null;
  voided_by_user_id: string | null;
  voided_at: Date | null;
  created_at: Date;
  dian_status?: 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | null;
}) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    customer_id: row.customer_id ?? null,
    branch_id: row.branch_id,
    cash_session_id: row.cash_session_id,
    table_order_id: row.table_order_id ?? null,
    sale_number: parseSaleNumber(row.sale_number),
    status: row.status,
    subtotal_cents: row.subtotal_cents,
    discount_cents: row.discount_cents,
    tip_cents: row.tip_cents,
    total_cents: row.total_cents,
    tax_total_cents: row.tax_total_cents,
    /**
     * Las líneas de impuesto salen de una columna `jsonb`, así que Kysely las entrega como
     * `unknown` y hasta ahora viajaban así hasta el navegador. El esquema compartido —el
     * mismo del que el frontend saca su tipo— promete un array de líneas con su categoría,
     * su base y su tasa. Nadie comprobaba que lo fuera: el frontend creía un tipo que el
     * servidor no garantizaba, y un `jsonb` con otra forma habría reventado en la pantalla
     * de un cajero sin un solo aviso por el camino.
     *
     * Se valida aquí, que es donde el dato entra al sistema de tipos. Si la fila trae algo
     * que no encaja, se devuelve vacío en vez de propagar basura: una venta sin desglose
     * de IVA se ve rara y se corrige; una venta con un desglose inventado se factura.
     */
    tax_lines_json: taxLinesSchema.safeParse(row.tax_lines_json).data ?? [],
    /**
     * Mismo caso que las líneas de impuesto, pero este no admite degradación.
     *
     * Es cómo se pagó la venta, y no existe un relleno honesto: cualquier valor por
     * defecto sería afirmar algo falso sobre dinero, y el contrato —con razón— no permite
     * nulo. Como esta columna la escribe nuestro propio `createSale` a partir de datos ya
     * validados, que no encaje significa corrupción o una migración mal hecha, no un caso
     * de uso. Así que revienta, fuerte y a la vista.
     *
     * El precio de esa decisión es real y conviene tenerlo escrito: una sola fila corrupta
     * tumba el listado entero de ventas. Se acepta porque la alternativa —devolver un
     * medio de pago inventado— es peor y además silenciosa.
     */
    payment_json: salePaymentJsonSchema.parse(row.payment_json),
    dian_status: row.dian_status ?? null,
    created_by_user_id: row.created_by_user_id,
    void_reason: row.void_reason ?? null,
    voided_by_user_id: row.voided_by_user_id ?? null,
    voided_at: row.voided_at ? row.voided_at.toISOString() : null,
    created_at: row.created_at.toISOString()
  };
}
