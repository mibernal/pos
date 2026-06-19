import type { Insertable } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';

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
    tax_lines_json: row.tax_lines_json,
    payment_json: row.payment_json,
    dian_status: row.dian_status ?? null,
    created_by_user_id: row.created_by_user_id,
    void_reason: row.void_reason ?? null,
    voided_by_user_id: row.voided_by_user_id ?? null,
    voided_at: row.voided_at ? row.voided_at.toISOString() : null,
    created_at: row.created_at.toISOString()
  };
}
