export type AppRoute = 'pos' | 'history' | 'products' | 'customers' | 'inventory' | 'reports';

export interface AppRouteDefinition {
  id: AppRoute;
  label: string;
}
