export type UserRole = 'PLATFORM_OWNER' | 'TENANT_OWNER' | 'ADMIN' | 'MANAGER' | 'CASHIER' | 'AUDITOR';

export type UserPermission =
  // Sales
  | 'sales:create'
  | 'sales:view'
  | 'sales:void'
  | 'returns:create'
  // Inventory
  | 'inventory:view'
  | 'inventory:adjust'
  | 'inventory:transfer'
  | 'inventory:receive'
  | 'inventory:approve_discrepancy'
  // Products
  | 'products:view'
  | 'products:manage'
  // Customers
  | 'customers:view'
  | 'customers:create'
  | 'customers:update'
  // Cash
  | 'cash:open'
  | 'cash:close'
  | 'cash:move'
  | 'cash:reconcile'
  | 'cash:audit'
  // Reporting
  | 'reports:view'
  | 'dashboard:view'
  | 'dashboard:global:view'
  // Terminals
  | 'terminals:view'
  | 'terminals:manage'
  // Alerts
  | 'alerts:view'
  | 'alerts:manage'
  // Audit
  | 'audit:view'
  // Settings (admin only)
  | 'settings:manage'
  | 'users:manage'
  | 'branches:manage'
  | 'branches:view'
  // Platform
  | 'platform:tenants:create'
  | 'platform:tenants:suspend'
  | 'platform:tenants:activate'
  | 'platform:plans:manage'
  | 'platform:metrics:view'
  | 'platform:impersonate'
  // Tenant Owner
  | 'tenant:settings:manage'
  | 'tenant:owner:manage';


export interface JwtClaims {
  sub: string;
  userId: string;
  tenantId: string | null;
  tenantPlan?: string | null;
  role: UserRole;
  email: string;
  name: string;
  branchIds: string[];
  permissions: UserPermission[];
  isPlatformRole: boolean;
  businessType?: string | null;
  enableRestaurant?: boolean;
  enableKds?: boolean;
  enableInventory?: boolean;
  enableFiscal?: boolean;
  enableLoyalty?: boolean;
  enableAdvancedReports?: boolean;
  enableTables?: boolean;
  enableDelivery?: boolean;
  enableWaiters?: boolean;
  enableSplitBill?: boolean;
  enableTips?: boolean;
  enableKitchen?: boolean;
  enableKitchenDisplay?: boolean;
  enableKitchenTickets?: boolean;
  enableKitchenPrinting?: boolean;
  enableOrderRounds?: boolean;
  enableProductModifiers?: boolean;
  enableReservations?: boolean;
  enableWaiterShifts?: boolean;
  enableQrMenu?: boolean;
  enableGuestsCount?: boolean;
  isImpersonating?: boolean;
  iat?: number;
  exp?: number;
}

export interface AuthContext {
  userId: string;
  tenantId: string | null;
  tenantPlan?: string | null;
  role: UserRole;
  email: string;
  name: string;
  branchIds: string[];
  permissions: UserPermission[];
  isPlatformRole: boolean;
  isImpersonating?: boolean;
  businessType?: string | null;
  enableRestaurant?: boolean;
  enableKds?: boolean;
  enableInventory?: boolean;
  enableFiscal?: boolean;
  enableLoyalty?: boolean;
  enableAdvancedReports?: boolean;
  enableTables?: boolean;
  enableDelivery?: boolean;
  enableWaiters?: boolean;
  enableSplitBill?: boolean;
  enableTips?: boolean;
  enableKitchen?: boolean;
  enableKitchenDisplay?: boolean;
  enableKitchenTickets?: boolean;
  enableKitchenPrinting?: boolean;
  enableOrderRounds?: boolean;
  enableProductModifiers?: boolean;
  enableReservations?: boolean;
  enableWaiterShifts?: boolean;
  enableQrMenu?: boolean;
  enableGuestsCount?: boolean;
  user_id: string;
  tenant_id: string | null;
}
