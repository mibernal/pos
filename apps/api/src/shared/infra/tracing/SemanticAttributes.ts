export const SemanticAttributes = {
  TENANT_ID: 'tenant.id',
  GATEWAY_NAME: 'billing.gateway',
  PLAN_ID: 'billing.plan_id',
  AMOUNT_CENTS: 'billing.amount_cents',
  JOB_TYPE: 'job.type',
  SUBSCRIPTION_STATUS: 'subscription.status',
  SALE_ID: 'sale.id',
  TRANSACTION_REFERENCE: 'billing.reference',
  WEBHOOK_STATUS_RESULT: 'billing.status_result',
  SALE_TOTAL_CENTS: 'sale.total_amount_cents',
  SALE_ITEMS_COUNT: 'sale.items_count',
  SALE_PAYMENT_MODE: 'sale.payment_mode',
  INVENTORY_PRODUCT_ID: 'inventory.product_id',
  INVENTORY_QTY_DELTA: 'inventory.quantity_delta',
  INVENTORY_REASON: 'inventory.reason'
} as const;
