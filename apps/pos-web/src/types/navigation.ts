import type { UserRole } from '../lib/api';

export type AppRoute = 'pos' | 'history' | 'cash-control' | 'products' | 'customers' | 'inventory' | 'inventory-adjustments' | 'reports' | 'dashboard' | 'users' | 'branches';

export interface AppRouteDefinition {
  id: AppRoute;
  label: string;
  requiredPermissions?: string[];
}
