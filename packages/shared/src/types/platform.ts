export type BillingCycle = 'MONTHLY' | 'YEARLY';

export interface BillingPlanFeatures {
  users: number; // -1 for unlimited
  branches: number; // -1 for unlimited
  support_level?: 'STANDARD' | 'PRIORITY' | 'DEDICATED';
  allow_offline?: boolean;
  custom_domain?: boolean;
}

export interface BillingPlan {
  id: string; // slug-like: 'STARTER', 'PRO'
  name: string;
  price_cents: number;
  billing_cycle: BillingCycle;
  features_json: BillingPlanFeatures;
  active: boolean;
  archived_at: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

export interface CreateBillingPlanInput {
  id: string;
  name: string;
  price_cents: number;
  billing_cycle: BillingCycle;
  features_json: BillingPlanFeatures;
}

export interface UpdateBillingPlanInput {
  name?: string;
  price_cents?: number;
  billing_cycle?: BillingCycle;
  features_json?: BillingPlanFeatures;
  active?: boolean;
  metadata_json?: Record<string, unknown> | null;
}

export interface PlatformDashboardMetrics {
  totalTenants: number;
  activeTenants: number;
  totalUsers: number;
  mrrCents: number;
  arrCents: number;
  activeTrials: number;
  expiringSubscriptions: number;
  suspendedTenants: number;
}

export interface PlatformGrowthMetric {
  month: string;
  tenants: number;
  users: number;
  revenueCents: number;
}

export interface PlatformActivityEvent {
  id: string;
  tenant_id: string | null;
  type: string;
  severity: string;
  actor_email: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface PlatformTenantSearchResult {
  id: string;
  name: string;
  business_name: string | null;
  document_number: string | null;
  status: string;
  plan_id: string | null;
  plan_name: string | null;
  plan_price_cents: number | null;
  subscription_status: string | null;
  owner_email: string | null;
  expires_at: string | null;
  created_at: string;
  business_type: string | null;
  enable_tables?: boolean;
  enable_delivery?: boolean;
  enable_waiters?: boolean;
  enable_split_bill?: boolean;
  enable_tips?: boolean;
  enable_kitchen?: boolean;
  enable_kitchen_display?: boolean;
  enable_kitchen_tickets?: boolean;
  enable_kitchen_printing?: boolean;
  enable_order_rounds?: boolean;
  enable_product_modifiers?: boolean;
  enable_reservations?: boolean;
  enable_waiter_shifts?: boolean;
  enable_qr_menu?: boolean;
  enable_guests_count?: boolean;
  enable_restaurant?: boolean;
  enable_kds?: boolean;
  enable_inventory?: boolean;
  enable_fiscal?: boolean;
  enable_loyalty?: boolean;
  enable_advanced_reports?: boolean;
}

export interface CreatePlatformTenantInput {
  name: string;
  business_name?: string;
  nit?: string;
  owner_email: string;
  owner_name: string;
  plan_id: string;
  business_type?: string;
  custom_business_type?: string | null;
  enable_tables?: boolean;
  enable_delivery?: boolean;
  enable_waiters?: boolean;
  enable_split_bill?: boolean;
  enable_tips?: boolean;
  enable_kitchen?: boolean;
  enable_kitchen_display?: boolean;
  enable_kitchen_tickets?: boolean;
  enable_kitchen_printing?: boolean;
  enable_order_rounds?: boolean;
  enable_product_modifiers?: boolean;
  enable_reservations?: boolean;
  enable_waiter_shifts?: boolean;
  enable_qr_menu?: boolean;
  enable_guests_count?: boolean;
  enable_restaurant?: boolean;
  enable_kds?: boolean;
  enable_inventory?: boolean;
  enable_fiscal?: boolean;
  enable_loyalty?: boolean;
  enable_advanced_reports?: boolean;
}

export interface UpdatePlatformTenantInput {
  name?: string;
  business_name?: string;
  nit?: string;
  address?: string;
  phone?: string;
  business_type?: string;
  custom_business_type?: string | null;
  enable_tables?: boolean;
  enable_delivery?: boolean;
  enable_waiters?: boolean;
  enable_split_bill?: boolean;
  enable_tips?: boolean;
  enable_kitchen?: boolean;
  enable_kitchen_display?: boolean;
  enable_kitchen_tickets?: boolean;
  enable_kitchen_printing?: boolean;
  enable_order_rounds?: boolean;
  enable_product_modifiers?: boolean;
  enable_reservations?: boolean;
  enable_waiter_shifts?: boolean;
  enable_qr_menu?: boolean;
  enable_guests_count?: boolean;
  enable_restaurant?: boolean;
  enable_kds?: boolean;
  enable_inventory?: boolean;
  enable_fiscal?: boolean;
  enable_loyalty?: boolean;
  enable_advanced_reports?: boolean;
}

export interface PlatformTenantUser {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  created_at: string;
}
