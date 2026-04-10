import type { AppRouteDefinition } from '../types';

export const APP_ROUTE_DEFINITIONS: readonly AppRouteDefinition[] = [
  {
    id: 'pos',
    label: 'POS'
  },
  {
    id: 'history',
    label: 'Historial'
  },
  {
    id: 'products',
    label: 'Productos'
  },
  {
    id: 'customers',
    label: 'Clientes'
  },
  {
    id: 'inventory',
    label: 'Inventario'
  },
  {
    id: 'reports',
    label: 'Reportes'
  }
] as const;
