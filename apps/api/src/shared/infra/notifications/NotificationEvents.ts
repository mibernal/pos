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
