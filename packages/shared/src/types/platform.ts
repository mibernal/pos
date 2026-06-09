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
