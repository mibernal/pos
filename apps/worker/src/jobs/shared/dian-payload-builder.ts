import type { Pool, PoolClient } from 'pg';

import type {
  DianProviderEmitSaleInput,
  DianProviderPaymentBreakdown,
  DianProviderSaleItemPayload,
  DianProviderTaxCategory,
  DianProviderTaxLinePayload,
  DianProviderTaxMode
} from '@pos-dian/shared/types/dian-provider.js';
import type { DianDocumentType } from '@pos-dian/shared';

export interface SaleHeaderRow {
  sale_id: string;
  sale_number: string;
  created_at: Date;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  tax_total_cents: number;
  tax_lines_json: unknown;
  payment_json: unknown;
  tax_mode: string;
  tenant_id: string;
  tenant_name: string;
  tenant_nit: string;
  tenant_business_name: string;
  branch_id: string;
  branch_name: string;
  branch_address: string;
}

export interface SaleItemRow {
  id: string;
  product_id: string;
  qty: string;
  price_cents: number;
  line_total_cents: number;
  product_name: string;
  barcode: string | null;
  tax_category: string;
}

type JsonRecord = Record<string, unknown>;

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.trunc(parsed);
    }
  }

  return null;
}

export function parseSaleNumber(rawSaleNumber: string): number {
  const parsed = Number(rawSaleNumber);
  if (Number.isFinite(parsed)) {
    return Math.trunc(parsed);
  }

  return 0;
}

export function normalizeTaxMode(value: unknown): DianProviderTaxMode {
  if (value === 'INC_RESTAURANT') {
    return 'INC_RESTAURANT';
  }

  return 'IVA';
}

export function normalizeTaxCategory(value: unknown): DianProviderTaxCategory {
  if (
    value === 'IVA_0' ||
    value === 'IVA_5' ||
    value === 'IVA_19' ||
    value === 'EXEMPT' ||
    value === 'EXCLUDED' ||
    value === 'INC_8' ||
    value === 'INC'
  ) {
    return value;
  }

  return 'EXCLUDED';
}

export function normalizeMethod(method: unknown): 'CASH' | 'CARD' | 'TRANSFER' | null {
  if (typeof method !== 'string') {
    return null;
  }

  const upper = method.toUpperCase();
  if (upper === 'CASH' || upper === 'CARD' || upper === 'TRANSFER') {
    return upper;
  }

  return null;
}

export function normalizePaymentBreakdown(
  rawPaymentJson: unknown,
  fallbackTotalCents: number
): DianProviderPaymentBreakdown {
  const defaultBreakdown: DianProviderPaymentBreakdown = {
    mode: 'MIXED',
    total_cents: fallbackTotalCents,
    amounts: {
      cash_cents: 0,
      card_cents: 0,
      transfer_cents: 0
    },
    payments: []
  };

  if (!isJsonRecord(rawPaymentJson)) {
    return defaultBreakdown;
  }

  const rawPayments = Array.isArray(rawPaymentJson.payments) ? rawPaymentJson.payments : [];
  const normalizedPayments = rawPayments
    .map((value) => {
      if (!isJsonRecord(value)) {
        return null;
      }

      const method = normalizeMethod(value.method);
      const amountCents = parsePositiveNumber(value.amount_cents);

      if (!method || amountCents === null) {
        return null;
      }

      return {
        method,
        amount_cents: amountCents
      };
    })
    .filter((value): value is { method: 'CASH' | 'CARD' | 'TRANSFER'; amount_cents: number } => value !== null);

  const amounts = {
    cash_cents: 0,
    card_cents: 0,
    transfer_cents: 0
  };

  for (const payment of normalizedPayments) {
    if (payment.method === 'CASH') {
      amounts.cash_cents += payment.amount_cents;
    } else if (payment.method === 'CARD') {
      amounts.card_cents += payment.amount_cents;
    } else {
      amounts.transfer_cents += payment.amount_cents;
    }
  }

  const rawMode = typeof rawPaymentJson.mode === 'string' ? rawPaymentJson.mode.toUpperCase() : '';
  const mode: DianProviderPaymentBreakdown['mode'] =
    rawMode === 'CASH' || rawMode === 'CARD' || rawMode === 'TRANSFER' || rawMode === 'MIXED'
      ? rawMode
      : normalizedPayments.length <= 1 && normalizedPayments[0]
        ? normalizedPayments[0].method
        : 'MIXED';

  const rawTotal = parsePositiveNumber(rawPaymentJson.total_cents);
  const totalCents = rawTotal ?? fallbackTotalCents;

  return {
    mode,
    total_cents: totalCents,
    amounts,
    payments: normalizedPayments
  };
}

export function normalizeTaxLines(rawTaxLinesJson: unknown): DianProviderTaxLinePayload[] {
  if (!Array.isArray(rawTaxLinesJson)) {
    return [];
  }

  return rawTaxLinesJson
    .map((value) => {
      if (!isJsonRecord(value)) {
        return null;
      }

      const rawLineIndex = parsePositiveNumber(value.line_index ?? value.lineIndex);
      const rawBaseCents = parsePositiveNumber(value.base_cents ?? value.baseCents);
      const rawTaxCents = parsePositiveNumber(value.tax_cents ?? value.taxCents);
      const rawRate = value.rate;

      if (
        rawLineIndex === null ||
        rawBaseCents === null ||
        rawTaxCents === null ||
        typeof rawRate !== 'number' ||
        !Number.isFinite(rawRate) ||
        rawRate < 0
      ) {
        return null;
      }

      return {
        lineIndex: rawLineIndex,
        category: normalizeTaxCategory(value.category),
        base_cents: rawBaseCents,
        tax_cents: rawTaxCents,
        rate: rawRate
      };
    })
    .filter((value): value is DianProviderTaxLinePayload => value !== null)
    .sort((a, b) => a.lineIndex - b.lineIndex);
}

export function toProviderItems(
  rows: SaleItemRow[],
  taxLines: DianProviderTaxLinePayload[]
): DianProviderSaleItemPayload[] {
  return rows.map((row, lineIndex) => {
    const taxLine = taxLines[lineIndex];
    const taxCategory = normalizeTaxCategory(row.tax_category);

    return {
      id: row.id,
      product_id: row.product_id,
      product_name: row.product_name,
      barcode: row.barcode,
      tax_category: taxCategory,
      category: taxLine?.category ?? taxCategory,
      base_cents: taxLine?.base_cents ?? row.line_total_cents,
      tax_cents: taxLine?.tax_cents ?? 0,
      rate: taxLine?.rate ?? 0,
      qty: Number(row.qty),
      price_cents: row.price_cents,
      line_total_cents: row.line_total_cents
    };
  });
}

export function buildIdempotencyKey(payloadJson: unknown, tenantId: string, saleId: string): string {
  if (isJsonRecord(payloadJson)) {
    const candidate = payloadJson.idempotency_key;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return `sale:${tenantId}:${saleId}`;
}

export async function loadProviderPayload(
  pool: Pool | PoolClient,
  tenantId: string,
  saleId: string,
  idempotencyKey: string,
  options?: {
    document_type?: DianDocumentType;
  }
): Promise<DianProviderEmitSaleInput> {
  const headerResult = await pool.query<SaleHeaderRow & { void_reason?: string }>(
    `
      SELECT
        s.id AS sale_id,
        s.sale_number::text AS sale_number,
        s.created_at,
        s.subtotal_cents,
        s.discount_cents,
        s.total_cents,
        s.tax_total_cents,
        s.tax_lines_json,
        s.payment_json,
        s.void_reason,
        t.tax_mode,
        t.id AS tenant_id,
        t.name AS tenant_name,
        t.nit AS tenant_nit,
        t.business_name AS tenant_business_name,
        b.id AS branch_id,
        b.name AS branch_name,
        b.address AS branch_address
      FROM sales s
      INNER JOIN tenants t ON t.id = s.tenant_id
      INNER JOIN branches b ON b.id = s.branch_id AND b.tenant_id = s.tenant_id
      WHERE s.tenant_id = $1
        AND s.id = $2
      LIMIT 1
    `,
    [tenantId, saleId]
  );

  const header = headerResult.rows[0];
  if (!header) {
    throw new Error(`Sale not found for tenant=${tenantId} sale=${saleId}`);
  }

  const taxMode = normalizeTaxMode(header.tax_mode);
  const taxLines = normalizeTaxLines(header.tax_lines_json);
  const taxTotalCents = header.tax_total_cents;

  const itemsResult = await pool.query<SaleItemRow>(
    `
      SELECT
        si.id,
        si.product_id,
        si.qty::text AS qty,
        si.price_cents,
        si.line_total_cents,
        p.name AS product_name,
        p.barcode,
        p.tax_category
      FROM sale_items si
      INNER JOIN products p ON p.id = si.product_id AND p.tenant_id = si.tenant_id
      WHERE si.tenant_id = $1
        AND si.sale_id = $2
      ORDER BY si.id ASC
    `,
    [tenantId, saleId]
  );

  const items = toProviderItems(itemsResult.rows, taxLines);
  const payments = normalizePaymentBreakdown(header.payment_json, header.total_cents);

  const payload: DianProviderEmitSaleInput = {
    sale_id: header.sale_id,
    tenant_id: header.tenant_id,
    branch_id: header.branch_id,
    taxMode,
    idempotency_key: idempotencyKey,
    tenant: {
      id: header.tenant_id,
      nit: header.tenant_nit,
      name: header.tenant_name,
      business_name: header.tenant_business_name
    },
    branch: {
      id: header.branch_id,
      name: header.branch_name,
      address: header.branch_address
    },
    sale: {
      id: header.sale_id,
      sale_number: parseSaleNumber(header.sale_number),
      created_at: header.created_at.toISOString(),
      subtotal_cents: header.subtotal_cents,
      discount_cents: header.discount_cents,
      total_cents: header.total_cents,
      tax_total_cents: taxTotalCents,
      tax_lines: taxLines,
      payments,
      items
    }
  };

  if (options?.document_type) {
    payload.document_type = options.document_type;
    if (options.document_type === 'CREDIT_NOTE') {
      payload.void_reason = header.void_reason ?? 'Anulación de venta';
    }
  }

  return payload;
}

