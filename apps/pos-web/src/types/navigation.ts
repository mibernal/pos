import type { UserRole } from '../lib/api'; // eslint-disable-line @typescript-eslint/no-unused-vars

export type AppRoute = 'pos' | 'history' | 'cash-control' | 'tables' | 'kds' | 'delivery' | 'products' | 'promotions' | 'customers' | 'inventory' | 'bulk-import' | 'reports' | 'dashboard' | 'users' | 'branches' | 'platform' | 'billing' | 'waiters' | 'reservations' | 'qr-menu';

export interface AppRouteDefinition {
  id: AppRoute;
  label: string;
  requiredPermissions?: string[];
}
