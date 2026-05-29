export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'AUDITOR';

export type UserPermission =
  // Sales
  | 'sales:create'
  | 'sales:void'
  | 'returns:create'
  // Inventory
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
  // Terminals
  | 'terminals:view'
  | 'terminals:manage'
  // Settings (admin only)
  | 'settings:manage';


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
