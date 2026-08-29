import type { ColumnType, Generated } from 'kysely';
import type { USER_ROLES } from '@pos-dian/shared';

/**
 * Refleja el enum `user_role_enum` de Postgres. Derivado del esquema compartido para que
 * no vuelva a divergir: esta lista estuvo sin `WAITER` mientras la base sí lo tenía desde
 * la migración 066, y por eso el rol existía en el motor pero era inalcanzable.
 */
export type UserRole = (typeof USER_ROLES)[number];
export type SaleStatus = 'COMPLETED' | 'VOID';
export type DianDocumentStatus = 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED';
export type DianDocumentType = 'INVOICE' | 'CREDIT_NOTE' | 'SUPPORT_DOC';
export type OutboxStatus = 'PENDING' | 'SENT' | 'FAILED';
export type InventoryOperation = 'SALE' | 'SALE_VOID' | 'SALE_RETURN' | 'MANUAL_ENTRY' | 'MANUAL_EXIT' | 'PURCHASE' | 'PO_RECEIPT' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'CYCLE_COUNT';
export type CashSessionStatus = 'OPEN' | 'CLOSED' | 'RECONCILED';
export type PoStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'COMPLETED' | 'CANCELED';
export type ReceiptStatus = 'DRAFT' | 'COMPLETED' | 'CANCELED';
export type TransferStatus = 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'REJECTED';
export type AdjustmentStatus = 'DRAFT' | 'COMPLETED' | 'CANCELED';
export type CountStatus = 'DRAFT' | 'COUNTING' | 'RECONCILING' | 'COMPLETED' | 'CANCELED';
export type ReceiptType = 'PO_LINKED' | 'BLIND';
export type TenantTaxMode = 'IVA' | 'INC_RESTAURANT' | 'REGIMEN_SIMPLIFICADO';
export type TenantDianProviderType = 'SIIGO' | 'ALEGRA' | 'FACTURA1' | 'FACTURADOR_PRO' | 'FACTURATECH' | 'HEKA' | 'DIAN_DIRECT' | 'HTTP_GENERIC' | 'MOCK';
export type ProductTaxCategory = 'IVA_0' | 'IVA_5' | 'IVA_19' | 'EXEMPT' | 'EXCLUDED' | 'INC_8';
// Debe coincidir EXACTAMENTE con el enum `inventory_ledger_operation` creado en la
// migración 042_immutable_ledgers.ts. Ampliar este tipo sin una migración que amplíe
// el enum produce errores de restricción en runtime que el compilador no detecta.
export type InventoryLedgerOperation = 'SALE_DISCHARGE' | 'RESTOCK' | 'VOID_RESTOCK' | 'ADJUSTMENT';
export type SalesLedgerOperation = 'SALE_CREATION' | 'SALE_VOID' | 'SALE_RETURN';
export type CashLedgerOperation = 'OPENING' | 'CASH_SALE' | 'CASH_REFUND' | 'MANUAL_IN' | 'MANUAL_OUT' | 'CLOSING_DISCREPANCY';
export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'SEATED' | 'CANCELLED' | 'NO_SHOW';
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
  /** Tipo de negocio seleccionado en el registro. Migration 059. */
  business_type: Generated<string>;
  /** Nombre libre cuando business_type = 'OTHER'. Migration 059. */
  custom_business_type: string | null;
  enable_restaurant: Generated<boolean>;
  enable_kds: Generated<boolean>;
  enable_inventory: Generated<boolean>;
  enable_fiscal: Generated<boolean>;
  enable_loyalty: Generated<boolean>;
  enable_advanced_reports: Generated<boolean>;
  /** Si TRUE, habilita módulos de gestión de mesas aunque el tipo sea 'OTHER'. Migration 059. */
  enable_tables: Generated<boolean>;
  enable_delivery: Generated<boolean>;
  enable_waiters: Generated<boolean>;
  enable_split_bill: Generated<boolean>;
  enable_tips: Generated<boolean>;
  enable_kitchen: Generated<boolean>;
  enable_kitchen_display: Generated<boolean>;
  enable_kitchen_tickets: Generated<boolean>;
  enable_kitchen_printing: Generated<boolean>;
  enable_order_rounds: Generated<boolean>;
  enable_product_modifiers: Generated<boolean>;
  enable_reservations: Generated<boolean>;
  enable_waiter_shifts: Generated<boolean>;
  enable_qr_menu: Generated<boolean>;
  enable_guests_count: Generated<boolean>;
  status: Generated<string>;
  suspended_at: Date | null;
  suspended_reason: string | null;
  owner_user_id: string | null;
  created_at: Generated<Date>;
}

export interface TenantDianSettingsTable {
  tenant_id: string; // PK, FK -> tenants.id
  provider_name: TenantDianProviderType;
  credentials: JsonObject; // JSONB
  test_mode: boolean;
  resolution_number: string | null;
  prefix: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface BranchesTable {
  id: string;
  tenant_id: string;
  name: string;
  address: string;
  created_at: Generated<Date>;
}

export interface TerminalsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  name: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrderRoundsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_order_id: string;
  waiter_id: string | null;
  round_number: number;
  status: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface KitchenTicketsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  round_id: string;
  table_order_id: string;
  course: Generated<number>;
  status: Generated<string>;
  printed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface KitchenTicketItemsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  kitchen_ticket_id: string;
  table_order_id: string;
  product_id: string;
  variant_id: string | null;
  qty: number;
  item_status: Generated<string>;
  notes: string | null;
  created_at: Generated<Date>;
}

export interface WaitersTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  user_id: string | null;
  name: string;
  pin: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UsersTable {
  id: string;
  tenant_id: string | null;
  email: string;
  password_hash: string;
  pin_hash: string | null;
  name: string;
  role: UserRole;
  active: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface RefreshTokensTable {
  id: string;
  tenant_id: string | null;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Generated<Date>;
  revoked_at: Date | null;
}

export interface PlatformSettingsTable {
  key: string;
  value: JsonColumn;
  updated_at: Generated<Date>;
}

export interface ImpersonationSessionsTable {
  id: string;
  platform_user_id: string;
  target_user_id: string;
  target_tenant_id: string;
  reason: string;
  created_at: Generated<Date>;
  expires_at: Date;
  revoked_at: Date | null;
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
  cost_cents: number;
  min_stock_alert_qty: number | null;
  active: Generated<boolean>;
  image_url: string | null;
  description: string | null;
  preparation_station: Generated<string>;
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

export interface ProductImagesTable {
  id: string;
  tenant_id: string;
  product_id: string;
  storage_provider: string;
  storage_key: string;
  filename: string;
  mime_type: string;
  size_bytes: string; // bigint comes as string in pg
  width: number | null;
  height: number | null;
  is_primary: Generated<boolean>;
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
  terminal_id: string;
  opened_by_user_id: string;
  opened_at: Generated<Date>;
  opening_amount_cents: number;
  status: CashSessionStatus;
  closed_at: Date | null;
  closing_cash_real_cents: number | null;
  expected_cash_cents: number | null;
  diff_cents: number | null;
}

export interface UserBranchesTable {
  tenant_id: string;
  user_id: string;
  branch_id: string;
  assigned_at: Generated<Date>;
}

export interface CashReconciliationsTable {
  id: string;
  tenant_id: string;
  cash_session_id: string;
  reconciled_by_user_id: string;
  final_cash_cents: number;
  system_expected_cents: number;
  discrepancy_cents: number;
  resolution_notes: string | null;
  created_at: Generated<Date>;
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
  table_order_id: string | null;
  sale_number: number;
  status: SaleStatus;
  subtotal_cents: number;
  discount_cents: number;
  tip_cents: Generated<number>;
  total_cents: number;
  tax_total_cents: Generated<number>;
  tax_lines_json: JsonArrayColumn;
  payment_json: JsonColumn;
  created_by_user_id: string;
  waiter_id: string | null;
  void_reason: string | null;
  voided_by_user_id: string | null;
  voided_at: Date | null;
  created_at: Generated<Date>;
}

export interface SaleItemsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  sale_id: string;
  product_id: string;
  variant_id: string | null;
  qty: string;
  price_cents: number;
  line_total_cents: number;
  notes: string | null;
  modifiers_json?: JsonArrayColumn | null;
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
  // Numeración fiscal asignada al emitir (migración 090). Nula mientras el documento no se
  // haya emitido: una venta que nunca llega al PAC no debe quemar un consecutivo.
  resolution_id: string | null;
  prefix: string | null;
  document_number: string | number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * Resoluciones de facturación autorizadas por la DIAN: prefijo, rango numérico y vigencia.
 * `current_number` lo mueve exclusivamente el worker al emitir; tocarlo a mano es la forma
 * más rápida de duplicar un número fiscal.
 */
export interface DianResolutionsTable {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  document_type: Generated<string>;
  resolution_number: string;
  resolution_date: Date | string;
  prefix: string;
  range_from: string | number;
  range_to: string | number;
  current_number: string | number;
  valid_from: Date | string;
  valid_until: Date | string;
  alert_threshold: Generated<number>;
  is_active: Generated<boolean>;
  technical_key: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OutboxEventsTable {
  id: string;
  tenant_id: string;
  type: string;
  event_version: Generated<number>;
  aggregate_type: string;
  aggregate_id: string;
  branch_id: string | null;
  payload_json: JsonColumn;
  metadata_json: JsonColumn | null;
  status: OutboxStatus;
  attempts: Generated<number>;
  next_retry_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuditLogsTable {
  id: string; // UUID
  tenant_id: string; // UUID
  branch_id: string | null; // UUID
  user_id: string | null; // UUID
  entity_type: string;
  entity_id: string;
  action: string;
  legacy_payload: unknown; // JSONB
  old_values: unknown | null; // JSONB
  new_values: unknown | null; // JSONB
  ip_address: string | null;
  user_agent: string | null;
  correlation_id: string | null; // UUID
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

export interface ReservationsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  table_id: string | null;
  reservation_date: Date;
  guests_count: Generated<number>;
  status: Generated<ReservationStatus>;
  notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InventoryBalancesTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  product_id: string;
  variant_id: string | null;
  on_hand_qty: string;
  reserved_qty: Generated<string>;
  in_transit_qty: Generated<string>;
  version: Generated<number>;
  updated_at: Generated<Date>;
}

export interface InventoryTransactionsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  product_id: string;
  variant_id: string | null;
  operation: InventoryOperation;
  reference_id: string | null;
  qty_change: string;
  balance_after: string | null;
  notes: string | null;
  created_by_user_id: string;
  created_at: Generated<Date>;
}

export interface SuppliersTable {
  id: string;
  tenant_id: string;
  name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PurchaseOrdersTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  supplier_id: string;
  status: Generated<PoStatus>;
  notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PurchaseOrderItemsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  po_id: string;
  product_id: string;
  variant_id: string | null;
  expected_qty: string;
  cost_cents: number;
}

export interface InventoryReceiptsTable {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  po_id: string | null;
  received_by_user_id: string;
  status: Generated<ReceiptStatus>;
  receipt_type: Generated<ReceiptType>;
  discrepancy_approved_by_user_id: string | null;
  notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InventoryReceiptItemsTable {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  receipt_id: string;
  product_id: string;
  variant_id: string | null;
  received_qty: string;
  cost_cents: number;
}

export interface InventoryTransfersTable {
  id: string;
  tenant_id: string;
  from_branch_id: string;
  to_branch_id: string;
  status: Generated<TransferStatus>;
  shipped_at: Date | null;
  received_at: Date | null;
  notes: string | null;
  created_by_user_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InventoryTransferItemsTable {
  id: string;
  tenant_id: string;
  transfer_id: string;
  product_id: string;
  variant_id: string | null;
  shipped_qty: string;
  received_qty: string | null;
}

export interface InventoryAdjustmentsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  reason: string;
  notes: string | null;
  status: Generated<AdjustmentStatus>;
  created_by_user_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InventoryAdjustmentItemsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  adjustment_id: string;
  product_id: string;
  variant_id: string | null;
  qty_change: string;
}

export interface SaleReturnsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  client_uuid: string;
  sale_id: string;
  created_by_user_id: string;
  total_refund_cents: number;
  reason: string | null;
  created_at: Generated<Date>;
}

export interface ReturnItemsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  return_id: string;
  product_id: string;
  qty: string;
  refund_cents: number;
  created_at: Generated<Date>;
}

export interface InventoryCountsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  name: string;
  status: Generated<CountStatus>;
  started_by_user_id: string;
  approved_by_user_id: string | null;
  created_at: Generated<Date>;
  completed_at: Date | null;
}

export interface InventoryCountItemsTable {
  id: Generated<string>;
  tenant_id: string;
  count_id: string;
  product_id: string;
  variant_id: string | null;
  system_qty: number;
  counted_qty: number;
  diff_qty: number;
  created_at: Generated<Date>;
}

export interface TenantAlertsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  type: string;
  severity: string;
  title: string;
  message: string;
  metadata: unknown | null;
  status: Generated<string>;
  created_at: Generated<Date>;
  resolved_at: Date | null;
  resolved_by_user_id: string | null;
}

export interface DailyBranchSalesRollupTable {
  tenant_id: string;
  branch_id: string;
  date: Date;
  total_revenue_cents: Generated<string>; // bigint comes as string
  total_voids_cents: Generated<string>; // bigint comes as string
  sales_count: Generated<number>;
  updated_at: Generated<Date>;
}

export interface InventoryValuationSnapshotTable {
  tenant_id: string;
  branch_id: string;
  date: Date;
  total_value_cents: Generated<string>;
  updated_at: Generated<Date>;
}

export interface SalesLedgerTable {
  id: Generated<string>;
  tenant_id: string;
  sale_id: string;
  type: SalesLedgerOperation;
  amount_cents: string; // bigint is represented as string in node-postgres
  tax_amount_cents: string;
  sequence_number: string;
  previous_hash: string;
  hash: string;
  created_at: Generated<Date>;
  created_by_user_id: string;
}

export interface InventoryLedgerTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  product_id: string;
  variant_id: string | null;
  operation_type: InventoryLedgerOperation;
  qty_change: string; // decimal is string
  balance_after: string; // decimal is string
  reference_id: string;
  sequence_number: string;
  previous_hash: string;
  hash: string;
  created_at: Generated<Date>;
}

export interface CashLedgerTable {
  id: Generated<string>;
  tenant_id: string;
  cash_session_id: string;
  terminal_id: string;
  type: CashLedgerOperation;
  amount_cents: string;
  balance_after_cents: string;
  sequence_number: string;
  previous_hash: string;
  hash: string;
  created_at: Generated<Date>;
}

export interface BillingPlansTable {
  id: string;
  name: string;
  price_cents: number;
  billing_cycle: Generated<string>;
  features_json: JsonColumn;
  active: Generated<boolean>;
  created_at: Generated<Date>;
  archived_at: Date | null;
  metadata_json: NullableJsonColumn;
}

export interface TenantSubscriptionsTable {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  current_period_start: Date;
  current_period_end: Date;
  starts_at: Date | null;
  expires_at: Date | null;
  trial_ends_at: Date | null;
  retry_count: Generated<number>;
  max_retries: Generated<number>;
  next_billing_at: Date | null;
  last_payment_attempt_at: Date | null;
  grace_period_days: Generated<number>;
  suspended_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  payment_method_token: string | null;
  auto_renew: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PaymentWebhookEventsTable {
  id: string;
  gateway: string;
  event_id: string | null;
  reference: string | null;
  signature_valid: boolean;
  status: Generated<string>;
  amount_cents: number | null;
  payload_json: JsonColumn;
  error: string | null;
  received_at: Generated<Date>;
  processed_at: Date | null;
}

export interface PlatformEventsTable {
  id: Generated<string>;
  tenant_id: string | null;
  type: string;
  severity: Generated<string>;
  actor_id: string | null;
  actor_email: string | null;
  metadata: JsonColumn;
  created_at: Generated<Date>;
}

export interface SubscriptionEventsTable {
  id: Generated<string>;
  subscription_id: string;
  type: string;
  metadata: JsonColumn;
  created_at: Generated<Date>;
}

export interface PaymentTransactionsTable {
  id: string;
  tenant_id: string;
  subscription_id: string | null;
  amount_cents: number;
  currency: Generated<string>;
  gateway: string;
  gateway_transaction_id: string | null;
  gateway_reference: string;
  status: string;
  attempt_number: Generated<number>;
  idempotency_key: string | null;
  metadata_json: NullableJsonColumn;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface BulkImportJobsTable {
  id: string;
  tenant_id: string;
  user_id: string;
  file_name: string;
  status: Generated<string>;
  total_rows: Generated<number>;
  valid_rows: Generated<number>;
  invalid_rows: Generated<number>;
  processed_rows: Generated<number>;
  payload_json: NullableJsonColumn;
  errors_json: NullableJsonColumn;
  created_at: Generated<Date>;
  completed_at: Date | null;
}

export interface IdempotencyRecordsTable {
  key: string;
  tenant_id: string;
  user_id: string | null;
  path: string;
  status_code: number;
  response_body_json: JsonColumn;
  created_at: Generated<Date>;
  expires_at: Date;
}

export interface RoomsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  name: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TablesTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  room_id: string;
  name: string;
  capacity: Generated<number>;
  status: Generated<string>;
  current_order_id: string | null;
  waiter_id: string | null;
  status_updated_at: Generated<Date>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TableOrdersTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_id: string;
  status: Generated<string>; // OPEN, COMPLETED
  subtotal_cents: Generated<number>;
  discount_cents: Generated<number>;
  tip_cents: Generated<number>;
  total_cents: Generated<number>;
  waiter_id: string | null;
  customer_id: string | null;
  guests_count: number | null;
  order_type: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TableOrderItemsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_order_id: string;
  round_id: string | null;
  seat_number: number | null;
  course: Generated<number>;
  item_status: Generated<string>;
  modifiers: unknown | null; // JSONB
  product_id: string;
  variant_id: string | null;
  qty: number;
  price_cents: number;
  line_total_cents: number;
  notes: string | null;
  sent_to_kitchen_at: Date | null;
  created_at: Generated<Date>;
}

export interface DeliveryPersonsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  name: string;
  phone: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DeliveriesTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  sale_id: string | null;
  status: string; // PENDING, PREPARING, ON_THE_WAY, DELIVERED, CANCELLED
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  delivery_neighborhood: string | null;
  delivery_notes: string | null;
  delivery_person_id: string | null;
  total_cents: number;
  status_updated_at: Generated<Date>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DeliveryItemsTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  delivery_id: string;
  product_id: string;
  variant_id: string | null;
  qty: string;
  price_cents: number;
  line_total_cents: number;
}

export interface TenantModuleAuditLogsTable {
  id: Generated<string>;
  tenant_id: string;
  performed_by: string;
  module_name: string;
  previous_state: boolean;
  new_state: boolean;
  reason: string;
  is_cascade: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface ProductModifierGroupsTable {
  id: string;
  tenant_id: string;
  product_id: string;
  name: string;
  is_required: Generated<boolean>;
  min_selections: Generated<number>;
  max_selections: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProductModifierOptionsTable {
  id: string;
  tenant_id: string;
  group_id: string;
  name: string;
  extra_price_cents: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Database {
  tenants: TenantsTable;
  branches: BranchesTable;
  users: UsersTable;
  user_branches: UserBranchesTable;
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
  cash_reconciliations: CashReconciliationsTable;
  refresh_tokens: RefreshTokensTable;
  terminals: TerminalsTable;
  suppliers: SuppliersTable;
  purchase_orders: PurchaseOrdersTable;
  purchase_order_items: PurchaseOrderItemsTable;
  inventory_receipts: InventoryReceiptsTable;
  inventory_receipt_items: InventoryReceiptItemsTable;
  inventory_transfers: InventoryTransfersTable;
  inventory_transfer_items: InventoryTransferItemsTable;
  inventory_adjustments: InventoryAdjustmentsTable;
  inventory_adjustment_items: InventoryAdjustmentItemsTable;
  inventory_counts: InventoryCountsTable;
  inventory_count_items: InventoryCountItemsTable;
  tenant_alerts: TenantAlertsTable;
  daily_branch_sales_rollup: DailyBranchSalesRollupTable;
  inventory_valuation_snapshot: InventoryValuationSnapshotTable;
  sales_ledger: SalesLedgerTable;
  inventory_ledger: InventoryLedgerTable;
  cash_ledger: CashLedgerTable;
  platform_settings: PlatformSettingsTable;
  impersonation_sessions: ImpersonationSessionsTable;
  billing_plans: BillingPlansTable;
  tenant_subscriptions: TenantSubscriptionsTable;
  payment_webhook_events: PaymentWebhookEventsTable;
  payment_transactions: PaymentTransactionsTable;
  bulk_import_jobs: BulkImportJobsTable;
  idempotency_records: IdempotencyRecordsTable;
  platform_events: PlatformEventsTable;
  subscription_events: SubscriptionEventsTable;
  product_images: ProductImagesTable;
  rooms: RoomsTable;
  tables: TablesTable;
  reservations: ReservationsTable;
  table_orders: TableOrdersTable;
  table_order_items: TableOrderItemsTable;
  order_rounds: OrderRoundsTable;
  kitchen_tickets: KitchenTicketsTable;
  kitchen_ticket_items: KitchenTicketItemsTable;
  delivery_persons: DeliveryPersonsTable;
  deliveries: DeliveriesTable;
  delivery_items: DeliveryItemsTable;
  tenant_dian_settings: TenantDianSettingsTable;
  dian_resolutions: DianResolutionsTable;
  waiters: WaitersTable;
  tenant_module_audit_logs: TenantModuleAuditLogsTable;
  product_modifier_groups: ProductModifierGroupsTable;
  product_modifier_options: ProductModifierOptionsTable;
}
