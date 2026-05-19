import type { ColumnType, Generated } from 'kysely';

export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'AUDITOR';
export type SaleStatus = 'COMPLETED' | 'VOID';
export type DianDocumentStatus = 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED';
<<<<<<< HEAD
export type DianDocumentType = 'INVOICE' | 'CREDIT_NOTE';
=======
export type DianDocumentType = 'INVOICE' | 'CREDIT_NOTE' | 'SUPPORT_DOC';
>>>>>>> aa2b4ca (refactor)
export type OutboxStatus = 'PENDING' | 'SENT' | 'FAILED';
export type InventoryOperation = 'SALE' | 'SALE_VOID' | 'SALE_RETURN' | 'MANUAL_ENTRY' | 'MANUAL_EXIT' | 'PURCHASE';
export type TenantTaxMode = 'IVA' | 'INC_RESTAURANT';
export type ProductTaxCategory = 'IVA_0' | 'IVA_5' | 'IVA_19' | 'EXEMPT' | 'EXCLUDED' | 'INC_8';
type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];
type JsonColumn = ColumnType<JsonObject, JsonObject | undefined, JsonObject>;
type JsonArrayColumn = ColumnType<JsonArray, JsonArray | undefined, JsonArray>;
type NullableJsonColumn = ColumnType<
  JsonObject | null,
  JsonObject | null | undefined,
  JsonObject | null
>;

export interface TenantsTable {
  id: string;
  name: string;
  nit: string;
  business_name: string;
  address: string;
  phone: string | null;
  footer_message: string | null;
  tax_mode: Generated<TenantTaxMode>;
  /** C3: Si TRUE (default), las ventas pueden dejar el inventario en negativo.
   *  Si FALSE, la API bloquea ventas sin stock suficiente. Migration 010. */
  allow_negative_stock: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface BranchesTable {
  id: string;
  tenant_id: string;
  name: string;
  address: string;
  created_at: Generated<Date>;
}

export interface UsersTable {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  active: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface ProductsTable {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  name: string;
  category: string;
  tax_category: Generated<ProductTaxCategory>;
  barcode: string | null;
  price_cents: number;
  min_stock_alert_qty: number | null;
  active: Generated<boolean>;
  image_url: string | null;
  description: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProductVariantsTable {
  id: string;
  tenant_id: string;
  product_id: string;
  name: string;
  price_cents: number;
  barcode: string | null;
  active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PromotionsTable {
  id: string;
  tenant_id: string;
  product_id: string;
  type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'BUY_X_GET_Y';
  value_cents: number;
  buy_qty: number | null;
  get_qty: number | null;
  start_date: Date;
  end_date: Date | null;
  active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CashSessionsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  opened_by_user_id: string;
  opened_at: Generated<Date>;
  opening_amount_cents: number;
  closed_at: Date | null;
  closing_cash_real_cents: number | null;
  expected_cash_cents: number | null;
  diff_cents: number | null;
}

export interface CashSessionAuditsTable {
  id: string;
  tenant_id: string;
  cash_session_id: string;
  user_id: string;
  observed_cash_cents: number;
  expected_cash_cents: number;
  diff_cents: number;
  notes: string | null;
  created_at: Generated<Date>;
}

export interface CashMovementsTable {
  id: string;
  tenant_id: string;
  cash_session_id: string;
  user_id: string;
  type: 'IN' | 'OUT';
  amount_cents: number;
  reason: string;
  created_at: Generated<Date>;
}

export interface SalesTable {
  id: string;
  tenant_id: string;
  client_uuid: string;
  customer_id: string | null;
  branch_id: string;
  cash_session_id: string;
  sale_number: number;
  status: SaleStatus;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  tax_total_cents: Generated<number>;
  tax_lines_json: JsonArrayColumn;
  payment_json: JsonColumn;
  created_by_user_id: string;
  void_reason: string | null;
  voided_by_user_id: string | null;
  voided_at: Date | null;
  created_at: Generated<Date>;
}

export interface SaleItemsTable {
  id: string;
  tenant_id: string;
  sale_id: string;
  product_id: string;
  variant_id: string | null;
  qty: string;
  price_cents: number;
  line_total_cents: number;
  created_at: Generated<Date>;
}

export interface DianDocumentsTable {
  id: string;
  tenant_id: string;
  sale_id: string;
  document_type: Generated<DianDocumentType>;
  parent_document_id: string | null;
  provider: string;
  status: DianDocumentStatus;
  cude: string | null;
  provider_payload_json: JsonColumn;
  provider_response_json: NullableJsonColumn;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OutboxEventsTable {
  id: string;
  tenant_id: string;
  type: string;
  aggregate_id: string;
  payload_json: JsonColumn;
  status: OutboxStatus;
  attempts: Generated<number>;
  next_retry_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuditLogsTable {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  user_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  payload_json: JsonColumn;
  created_at: Generated<Date>;
}

export interface CustomersTable {
  id: string;
  tenant_id: string;
  document_type: string;
  document_number: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InventoryBalancesTable {
  tenant_id: string;
  branch_id: string;
  product_id: string;
  qty: string;
  updated_at: Generated<Date>;
}

export interface InventoryTransactionsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  product_id: string;
  operation: InventoryOperation;
  reference_id: string | null;
  qty_change: string;
  notes: string | null;
  created_by_user_id: string;
  created_at: Generated<Date>;
}

export interface SaleReturnsTable {
  id: string;
  tenant_id: string;
  sale_id: string;
  created_by_user_id: string;
  total_refund_cents: number;
  reason: string | null;
  created_at: Generated<Date>;
}

export interface ReturnItemsTable {
  id: string;
  tenant_id: string;
  return_id: string;
  product_id: string;
  qty: string;
  refund_cents: number;
  created_at: Generated<Date>;
}

export interface Database {
  tenants: TenantsTable;
  branches: BranchesTable;
  users: UsersTable;
  products: ProductsTable;
  product_variants: ProductVariantsTable;
  promotions: PromotionsTable;
  customers: CustomersTable;
  inventory_balances: InventoryBalancesTable;
  inventory_transactions: InventoryTransactionsTable;
  cash_sessions: CashSessionsTable;
  cash_session_audits: CashSessionAuditsTable;
  sales: SalesTable;
  sale_items: SaleItemsTable;
  sale_returns: SaleReturnsTable;
  return_items: ReturnItemsTable;
  dian_documents: DianDocumentsTable;
  outbox_events: OutboxEventsTable;
  audit_logs: AuditLogsTable;
  cash_movements: CashMovementsTable;
}
