export interface TenantWelcomePayload {
  tenantName: string;
  ownerName: string;
  planName: string;
}

export interface LowStockPayload {
  productName: string;
  currentQty: number;
  threshold: number;
  branchName: string;
}

export interface SubscriptionExpiringPayload {
  tenantName: string;
  planName: string;
  daysRemaining: number;
  expirationDate: string;
}

export interface PaymentApprovedPayload {
  tenantName: string;
  planName: string;
  amount: number;
  currency: string;
  receiptUrl?: string;
}

export interface PaymentRejectedPayload {
  tenantName: string;
  reason: string;
  retryUrl?: string;
}

export interface PlanChangePayload {
  tenantName: string;
  oldPlanName: string;
  newPlanName: string;
}

/* ------------------------------------------------------------------ *
 * Cobro recurrente
 * ------------------------------------------------------------------ */

export interface RenewalReminderPayload {
  tenantName: string;
  planName: string;
  daysRemaining: number;
  renewalDate: string;
  amountCents: number;
  hasPaymentMethod: boolean;
  portalUrl?: string;
}

export interface ChargeFailedPayload {
  tenantName: string;
  planName: string;
  amountCents: number;
  reason: string;
  attempt: number;
  /** Intentos en total, contando el primero: `max_retries` + 1. */
  totalAttempts: number;
  /** Cuándo se vuelve a intentar. Ausente cuando ya no quedan reintentos. */
  nextRetryDate?: string;
  suspensionDate?: string;
  portalUrl?: string;
}

export interface SubscriptionSuspendedPayload {
  tenantName: string;
  planName: string;
  amountCents: number;
  suspendedOn: string;
  portalUrl?: string;
}

export interface InvoicePaidPayload {
  tenantName: string;
  planName: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  amountCents: number;
  portalUrl?: string;
}
