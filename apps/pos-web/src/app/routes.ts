import type { AppRouteDefinition } from '../types';
import type { BusinessModule } from '@pos-dian/shared';

// Se extiende localmente el tipo (o se asume que AppRouteDefinition soporta esto)
// Para no romper la interfaz exportada en types, lo definimos aquí temporalmente o la actualizamos.
export type EnhancedRouteDefinition = AppRouteDefinition & {
  requiredModule?: BusinessModule;
};

export const APP_ROUTE_DEFINITIONS: readonly EnhancedRouteDefinition[] = [
  {
    id: 'pos',
    label: 'POS',
    requiredPermissions: ['sales:create']
  },
  {
    id: 'history',
    label: 'Historial',
    requiredPermissions: ['sales:create', 'sales:view', 'reports:view']
  },
  {
    id: 'cash-control',
    label: 'Control de Caja',
    requiredPermissions: ['cash:open', 'cash:close']
  },
  {
    id: 'tables',
    label: 'Mesas',
    requiredPermissions: ['sales:create'],
    requiredModule: 'tables'
  },
  {
    id: 'delivery',
    label: 'Domicilios',
    requiredPermissions: ['sales:create'],
    requiredModule: 'delivery'
  },
  {
    id: 'products',
    label: 'Productos',
    requiredPermissions: ['products:view']
  },
  {
    id: 'promotions',
    label: 'Promociones',
    requiredPermissions: ['products:manage']
  },
  {
    id: 'customers',
    label: 'Clientes',
    requiredPermissions: ['customers:view']
  },
  {
    id: 'inventory',
    label: 'Inventario',
    requiredPermissions: ['inventory:view', 'inventory:adjust', 'inventory:transfer', 'inventory:receive']
  },
  {
    id: 'bulk-import',
    label: 'Importación Masiva',
    requiredPermissions: ['products:manage', 'inventory:adjust']
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
  },
  {
    id: 'platform',
    label: 'Plataforma',
    requiredPermissions: ['platform:tenants:create']
  },
  {
    id: 'billing',
    label: 'Facturación / Plan',
    requiredPermissions: ['tenant:settings:manage']
  }
] as const;
