import type { UserRole } from '../lib/api';

export type AppRoute = 'pos' | 'history' | 'cash-control' | 'products' | 'promotions' | 'customers' | 'inventory' | 'bulk-import' | 'reports' | 'dashboard' | 'users' | 'branches' | 'platform' | 'billing';

export interface AppRouteDefinition {
  id: AppRoute;
  label: string;
  requiredPermissions?: string[];
}
