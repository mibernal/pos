import type { AppRouteDefinition } from '../types';

export const APP_ROUTE_DEFINITIONS: readonly AppRouteDefinition[] = [
  {
    id: 'pos',
    label: 'POS',
    allowedRoles: ['ADMIN', 'MANAGER', 'CASHIER']
  },
  {
    id: 'history',
    label: 'Historial',
    allowedRoles: ['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR']
  },
  {
    id: 'cash-control',
    label: 'Control de Caja',
    allowedRoles: ['ADMIN', 'MANAGER', 'CASHIER']
  },
  {
    id: 'products',
    label: 'Productos',
    allowedRoles: ['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR']
  },
  {
    id: 'customers',
    label: 'Clientes',
    allowedRoles: ['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR']
  },
  {
    id: 'inventory',
    label: 'Inventario',
    allowedRoles: ['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR']
  },
  {
    id: 'reports',
    label: 'Reportes',
    allowedRoles: ['ADMIN', 'MANAGER', 'AUDITOR']
  }
] as const;
