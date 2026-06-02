import type { UserRole } from '../lib/api';

export type AppRoute = 'pos' | 'history' | 'cash-control' | 'products' | 'promotions' | 'customers' | 'inventory' | 'reports' | 'dashboard' | 'users' | 'branches';

export interface AppRouteDefinition {
  id: AppRoute;
  label: string;
  requiredPermissions?: string[];
}
