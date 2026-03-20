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
}

export interface DianProviderEmitSaleResult {
  status: DianProviderResultStatus;
  cude: string | null;
  raw: Record<string, unknown>;
}

export interface DianProvider {
  emitSale(input: DianProviderEmitSaleInput): Promise<DianProviderEmitSaleResult>;
}
