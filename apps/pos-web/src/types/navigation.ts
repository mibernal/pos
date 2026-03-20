export type AppRoute = 'pos' | 'history' | 'products';

export interface AppRouteDefinition {
  id: AppRoute;
  label: string;
}
