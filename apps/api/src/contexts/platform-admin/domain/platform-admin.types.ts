export type TaxMode = 'IVA' | 'INC_RESTAURANT' | 'REGIMEN_SIMPLIFICADO';
export type TenantDocumentType = 'NIT' | 'CC' | 'CE' | 'PASSPORT';
export type TenantRole = 'TENANT_OWNER' | 'ADMIN' | 'MANAGER' | 'CASHIER' | 'AUDITOR';
export type BillingCycle = 'MONTHLY' | 'YEARLY';
export type SupportLevel = 'STANDARD' | 'PRIORITY' | 'DEDICATED';

export interface PlanFeatures {
  users: number;
  branches: number;
  support_level?: SupportLevel;
  allow_offline?: boolean;
  custom_domain?: boolean;
}

export interface PlatformUserAuth {
  userId: string;
  email: string;
}

export interface CreateTenantCommand {
  email: string;
  password?: string;
  name: string;
  tenant_name: string;
  tenant_business_name: string;
  tenant_document_type: TenantDocumentType;
  tenant_document_number: string;
  tax_mode: TaxMode;
  plan: string;
  business_type?: string;
  custom_business_type?: string | null;
  enable_tables?: boolean;
}

export interface UpdateTenantCommand {
  name?: string;
  business_name?: string;
  nit?: string;
  tax_mode?: TaxMode;
  owner_name?: string;
  owner_email?: string;
  business_type?: string;
  custom_business_type?: string | null;
  enable_tables?: boolean;
}

export interface CreatePlanCommand {
  id: string;
  name: string;
  price_cents: number;
  billing_cycle: BillingCycle;
  features_json: PlanFeatures;
}

export interface UpdatePlanCommand {
  name?: string;
  price_cents?: number;
  billing_cycle?: BillingCycle;
  features_json?: PlanFeatures;
  active?: boolean;
  metadata_json?: Record<string, unknown> | null;
}

export interface CreateTenantUserCommand {
  email: string;
  password?: string;
  name: string;
  role: TenantRole;
  active: boolean;
}

export interface UpdateTenantUserCommand {
  name?: string;
  role?: TenantRole;
  active?: boolean;
}
