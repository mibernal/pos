export type DianProviderResultStatus = 'SENT' | 'ACCEPTED' | 'REJECTED';
export type DianProviderTaxMode = 'IVA' | 'INC_RESTAURANT';
export type DianProviderTaxCategory =
  | 'IVA_0'
  | 'IVA_5'
  | 'IVA_19'
  | 'EXEMPT'
  | 'EXCLUDED'
  | 'INC_8'
  | 'INC';

export interface DianProviderTenantPayload {
  id: string;
  nit: string;
  name: string;
  business_name: string;
}

export interface DianProviderBranchPayload {
  id: string;
  name: string;
  address: string;
}

export interface DianProviderPaymentBreakdown {
  mode: 'CASH' | 'CARD' | 'TRANSFER' | 'MIXED';
  total_cents: number;
  amounts: {
    cash_cents: number;
    card_cents: number;
    transfer_cents: number;
  };
  payments: Array<{
    method: 'CASH' | 'CARD' | 'TRANSFER';
    amount_cents: number;
  }>;
}

export interface DianProviderSaleItemPayload {
  id: string;
  product_id: string;
  product_name: string;
  barcode: string | null;
  tax_category: DianProviderTaxCategory;
  category: DianProviderTaxCategory;
  base_cents: number;
  tax_cents: number;
  rate: number;
  qty: number;
  price_cents: number;
  line_total_cents: number;
}

export interface DianProviderTaxLinePayload {
  lineIndex: number;
  category: DianProviderTaxCategory;
  base_cents: number;
  tax_cents: number;
  rate: number;
}

export interface DianProviderSalePayload {
  id: string;
  sale_number: number;
  created_at: string;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  tax_total_cents: number;
  tax_lines: DianProviderTaxLinePayload[];
  payments: DianProviderPaymentBreakdown;
  items: DianProviderSaleItemPayload[];
}

/**
 * Numeración autorizada por la DIAN.
 *
 * `sale.sale_number` es el contador interno del comercio y no sirve como número de factura
 * electrónica: la DIAN autoriza una resolución con prefijo y rango, y el documento tiene
 * que llevar un número de ese rango. El CUFE/CUDE se calcula sobre él.
 */
export interface DianProviderNumberingPayload {
  resolution_number: string;
  resolution_date: string;
  prefix: string;
  document_number: number;
  /** Número completo tal como se imprime y se envía: `SETP990000001`. */
  full_number: string;
  range_from: number;
  range_to: number;
  valid_from: string;
  valid_until: string;
  /** Clave técnica de la resolución; algunos PAC la exigen para firmar. */
  technical_key: string | null;
}

export interface DianProviderEmitSaleInput {
  sale_id: string;
  tenant_id: string;
  branch_id: string;
  document_type?: 'INVOICE' | 'CREDIT_NOTE';
  void_reason?: string;
  taxMode: DianProviderTaxMode;
  idempotency_key: string;
  tenant: DianProviderTenantPayload;
  branch: DianProviderBranchPayload;
  sale: DianProviderSalePayload;
  numbering?: DianProviderNumberingPayload;
}

/**
 * Consulta del estado de un documento ya enviado.
 *
 * La emisión es asíncrona: el PAC acusa recibo (`SENT`) y resuelve después. Sin una forma
 * de preguntar, un documento puede quedarse en `SENT` para siempre sin que nadie se entere.
 * Opcional en la interfaz porque no todos los proveedores la ofrecen; cuando falta, el
 * cierre del ciclo depende del webhook del PAC.
 */
export interface DianProviderStatusQueryInput {
  tenant_id: string;
  document_id: string;
  cude: string | null;
  prefix: string | null;
  document_number: number | null;
}

export interface DianProviderStatusQueryResult {
  status: DianProviderResultStatus | 'UNKNOWN';
  cude: string | null;
  raw: Record<string, unknown>;
}

export interface DianProviderEmitSaleResult {
  status: DianProviderResultStatus;
  cude: string | null;
  raw: Record<string, unknown>;
}

export interface DianProvider {
  emitSale(input: DianProviderEmitSaleInput): Promise<DianProviderEmitSaleResult>;
  /** Opcional: no todos los PAC exponen consulta de estado. */
  queryStatus?(input: DianProviderStatusQueryInput): Promise<DianProviderStatusQueryResult>;
}
