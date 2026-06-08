import type { UserRole } from '../lib/api'; // eslint-disable-line @typescript-eslint/no-unused-vars

export type AppRoute = 'pos' | 'history' | 'cash-control' | 'products' | 'promotions' | 'customers' | 'inventory' | 'bulk-import' | 'reports' | 'dashboard' | 'users' | 'branches' | 'platform' | 'billing';

export interface AppRouteDefinition {
  id: AppRoute;
  label: string;
  requiredPermissions?: string[];
}
