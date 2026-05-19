export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'AUDITOR';

export type DianStatus = 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED';
export type DianDocumentType = 'INVOICE' | 'CREDIT_NOTE';

export type SaleStatus = 'COMPLETED' | 'VOID';

export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER';

export type PaymentMode = PaymentMethod | 'MIXED';

export type ProductTaxCategory = 'IVA_0' | 'IVA_5' | 'IVA_19' | 'EXEMPT' | 'EXCLUDED' | 'INC_8';

export type SaleTaxCategory = ProductTaxCategory | 'INC';

export interface AuthUser {
  id: string;
  tenantId: string;
  taxMode?: 'IVA' | 'INC_RESTAURANT';
  role: UserRole;
  email: string;
  name: string;
  active: boolean;
}

export interface Product {
  id: string;
  tenantId: string;
  branchId: string | null;
  name: string;
  category: string;
  taxCategory: ProductTaxCategory;
  barcode: string | null;
  price_cents: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SalePayment {
  method: PaymentMethod;
  amount_cents: number;
}

export interface SalePaymentBreakdown {
  mode: PaymentMode;
  total_cents: number;
  amounts: {
    cash_cents: number;
    card_cents: number;
    transfer_cents: number;
  };
  payments: SalePayment[];
}

export interface SaleTaxLine {
  line_index: number;
  category: SaleTaxCategory;
  base_cents: number;
  tax_cents: number;
  rate: number;
}

export interface SaleItemInput {
  product_id: string;
  qty: number;
  price_cents?: number;
  tax_category?: ProductTaxCategory;
}

export interface SaleItem {
  id: string;
  product_id: string;
  qty: number;
  price_cents: number;
  line_total_cents: number;
}

export interface Sale {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  branch_id: string;
  cash_session_id: string;
  sale_number: number;
  status: SaleStatus;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  tax_total_cents: number;
  tax_lines_json: SaleTaxLine[];
  payment_json: SalePaymentBreakdown;
  dian_status: DianStatus | null;
  created_by_user_id: string;
  void_reason: string | null;
  voided_by_user_id: string | null;
  voided_at: string | null;
  created_at: string;
}

export interface CreateSale {
  client_uuid: string;
  customer_id?: string | null;
  branch_id: string;
  cash_session_id: string;
  items: SaleItemInput[];
  discount_cents: number;
  payments: Array<SalePayment | { method: 'MIXED'; payments: SalePayment[] }>;
}

export interface DianEmissionRequest {
  sale_id: string;
  tenant_id: string;
  branch_id: string;
  idempotency_key: string;
  created_at: string;
}
