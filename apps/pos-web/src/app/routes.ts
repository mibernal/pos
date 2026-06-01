import type { AppRouteDefinition } from '../types';

export const APP_ROUTE_DEFINITIONS: readonly AppRouteDefinition[] = [
  {
    id: 'pos',
    label: 'POS',
    requiredPermissions: ['sales:create']
  },
  {
    id: 'history',
    label: 'Historial',
    requiredPermissions: ['sales:create', 'reports:view']
  },
  {
    id: 'cash-control',
    label: 'Control de Caja',
    requiredPermissions: ['cash:open', 'cash:close']
  },
  {
    id: 'products',
    label: 'Productos',
    requiredPermissions: ['products:view']
  },
  {
    id: 'customers',
    label: 'Clientes',
    requiredPermissions: ['customers:view']
  },
  {
    id: 'inventory',
    label: 'Inventario',
    requiredPermissions: ['products:view', 'inventory:adjust', 'inventory:transfer', 'inventory:receive']
  },
  {
    id: 'inventory-adjustments',
    label: 'Ajustes',
    requiredPermissions: ['inventory:adjust']
  },
  {
    id: 'reports',
    label: 'Reportes',
    requiredPermissions: ['reports:view']
  },
  {
    id: 'dashboard',
    label: 'Dashboard Live',
    requiredPermissions: ['dashboard:view']
  },
  {
    id: 'users',
    label: 'Usuarios',
    requiredPermissions: ['users:manage']
  },
  {
    id: 'branches',
    label: 'Sucursales',
    requiredPermissions: ['branches:manage']
  }
] as const;
