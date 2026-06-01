export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'AUDITOR';

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
  | 'branches:view';


export interface JwtClaims {
  sub: string;
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
  name: string;
  branchIds: string[];
  permissions: UserPermission[];
  iat?: number;
  exp?: number;
}

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
  name: string;
  branchIds: string[];
  permissions: UserPermission[];
  user_id: string;
  tenant_id: string;
}
