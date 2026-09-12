import type { AppRoute, AppRouteDefinition } from '../types';
import type { BusinessModule } from '@pos-dian/shared';

/**
 * La definición de una ruta es su guarda.
 *
 * Antes cada pantalla se protegía dos veces: aquí, para decidir si aparece en el menú, y en
 * `App.tsx`, con un `PermissionGuard` y un `ModuleGuard` escritos a mano al renderizarla. Las
 * dos copias divergieron: el menú escondía el KDS a quien no tuviera `kitchen_display`,
 * mientras la pantalla solo exigía `kitchen`. Ahora la guarda se lee de aquí en los dos
 * sitios, así que no pueden separarse.
 */
export type EnhancedRouteDefinition = AppRouteDefinition & {
  requiredModule?: BusinessModule;
  /** `bulk-import` es la única que exige todos los permisos a la vez, no uno cualquiera. */
  requireAllPermissions?: boolean;
  /** Las pantallas del POS necesitan sucursal y caja abiertas; las de administración no. */
  requiresPosContext?: boolean;
};

/**
 * Lo que un turno de caja usa de verdad, y por tanto lo que se queda en la barra.
 *
 * Hay veintiuna rutas. Un administrador ve dieciocho, y dieciocho botones no caben en una
 * línea: envolvían en dos filas y, con el bloque de usuario, la barra se comía **235 px de
 * una pantalla de 1440** — un cuarto del alto en cromo antes de llegar al contenido.
 *
 * La respuesta no es esconder cosas por ancho, que es lo mismo que perderlas. Es aceptar
 * que no todo se usa con la misma frecuencia: estas seis se tocan cada turno y se quedan a
 * la vista; el catálogo y la administración se tocan de vez en cuando y viven un clic más
 * lejos, en «Más», donde siguen estando todas.
 *
 * Si alguna de estas deja de ser cosa del turno —o al revés—, se cambia aquí y ya.
 */
const OPERACION_DIARIA: ReadonlySet<AppRoute> = new Set<AppRoute>([
  'pos',
  'history',
  'cash-control',
  'tables',
  'kds',
  'delivery'
]);

/**
 * Lo que se administra sobre lo que se vende: la carta, el stock, quién compra.
 *
 * Separar esto de la administración pura no es adorno. Sin agrupar, «Más» era una lista de
 * once nombres seguidos — el mismo problema que acababa de quitarse de la barra, mudado un
 * clic más adentro. Con dos títulos, se busca por zona y no leyendo once.
 */
const CATALOGO: ReadonlySet<AppRoute> = new Set<AppRoute>([
  'products',
  'promotions',
  'recipes',
  'customers',
  'inventory',
  'bulk-import'
]);

export type GrupoDeRuta = 'operacion' | 'catalogo' | 'administracion';

export function grupoDeRuta(id: AppRoute): GrupoDeRuta {
  if (OPERACION_DIARIA.has(id)) return 'operacion';
  if (CATALOGO.has(id)) return 'catalogo';
  return 'administracion';
}

export const TITULO_DE_GRUPO: Record<GrupoDeRuta, string> = {
  operacion: 'Operación',
  catalogo: 'Catálogo',
  administracion: 'Administración'
};

/** La URL de una ruta es su identificador. Una sola regla, sin tabla de traducción. */
export function pathForRoute(id: AppRoute): string {
  return `/${id}`;
}

export function routeForPath(pathname: string): AppRoute | null {
  const id = pathname.split('/').filter(Boolean)[0];
  return APP_ROUTE_DEFINITIONS.some((r) => r.id === id) ? (id as AppRoute) : null;
}

/**
 * Quién puede entrar a una ruta.
 *
 * Una sola función para las dos preguntas que antes se respondían por separado: si la ruta
 * aparece en el menú (`usePosNavigation`) y si se puede entrar por su URL (`RouteGuard`).
 * Tenerlas separadas es lo que dejó al KDS escondido del menú por `kitchen_display` y
 * accesible por `kitchen`.
 *
 * Devuelve el motivo y no un booleano porque quien llega por un enlace guardado merece saber
 * si le falta un permiso o le falta el plan: son cosas distintas y se arreglan en sitios
 * distintos.
 */
export type RouteAccess = 'ok' | 'missing-module' | 'missing-permission';

export function routeAccess(
  definition: EnhancedRouteDefinition,
  user: { role?: string; permissions?: string[] } | null | undefined,
  hasModule: (module: BusinessModule) => boolean
): RouteAccess {
  const isPlatformOwner = user?.role === 'PLATFORM_OWNER';

  // El equipo de la plataforma solo ve la plataforma, y nadie más la ve.
  if (isPlatformOwner) return definition.id === 'platform' ? 'ok' : 'missing-permission';
  if (definition.id === 'platform') return 'missing-permission';

  if (definition.requiredModule && !hasModule(definition.requiredModule)) return 'missing-module';

  // El dueño y el administrador ven todo lo de su comercio: los permisos por rol son para
  // acotar al personal, no para acotar a quien lo contrata.
  if (user?.role === 'ADMIN' || user?.role === 'TENANT_OWNER') return 'ok';

  const requeridos = definition.requiredPermissions ?? [];
  if (requeridos.length === 0) return 'ok';

  const permisos = user?.permissions ?? [];
  const tiene = definition.requireAllPermissions
    ? requeridos.every((p) => permisos.includes(p))
    : requeridos.some((p) => permisos.includes(p));

  return tiene ? 'ok' : 'missing-permission';
}

export const APP_ROUTE_DEFINITIONS: readonly EnhancedRouteDefinition[] = [
  {
    id: 'pos',
    label: 'POS',
    requiredPermissions: ['sales:create'],
    requiresPosContext: true
  },
  {
    id: 'history',
    label: 'Historial',
    requiredPermissions: ['sales:create', 'sales:view', 'reports:view'],
    requiresPosContext: true
  },
  {
    id: 'cash-control',
    label: 'Control de Caja',
    requiredPermissions: ['cash:open', 'cash:close'],
    requiresPosContext: true
  },
  {
    id: 'tables',
    label: 'Mesas',
    requiredPermissions: ['sales:create'],
    requiredModule: 'tables',
    requiresPosContext: true
  },
  {
    id: 'kds',
    label: 'Cocina (KDS)',
    requiredPermissions: ['sales:create'],
    // El menú ya escondía esta pantalla por `kitchen_display`; la pantalla en sí solo pedía
    // `kitchen`. Manda la del menú: es la que decide lo que el comercio puede alcanzar.
    requiredModule: 'kitchen_display',
    requiresPosContext: true
  },
  {
    id: 'delivery',
    label: 'Domicilios',
    requiredPermissions: ['sales:create'],
    requiredModule: 'delivery',
    requiresPosContext: true
  },
  {
    id: 'products',
    label: 'Productos',
    requiredPermissions: ['products:view'],
    requiresPosContext: true
  },
  {
    id: 'promotions',
    label: 'Promociones',
    requiredPermissions: ['products:manage'],
    requiresPosContext: true
  },
  {
    id: 'customers',
    label: 'Clientes',
    requiredPermissions: ['customers:view'],
    requiresPosContext: true
  },
  {
    id: 'inventory',
    label: 'Inventario',
    requiredPermissions: ['inventory:view', 'inventory:adjust', 'inventory:transfer', 'inventory:receive'],
    requiresPosContext: true
  },
  {
    id: 'bulk-import',
    label: 'Importación Masiva',
    requiredPermissions: ['products:manage', 'inventory:adjust'],
    // La única que los exige los dos a la vez, no uno cualquiera.
    requireAllPermissions: true,
    requiresPosContext: true
  },

  {
    id: 'reports',
    label: 'Reportes',
    requiredPermissions: ['reports:view'],
    requiresPosContext: true
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
  },
  {
    id: 'waiters',
    label: 'Meseros',
    requiredPermissions: ['branches:manage'],
    requiredModule: 'waiters'
  },
  {
    id: 'reservations',
    label: 'Reservaciones',
    requiredPermissions: ['sales:create'],
    requiredModule: 'reservations',
    requiresPosContext: true
  },
  {
    id: 'recipes',
    label: 'Recetas',
    requiredPermissions: ['inventory:view'],
    requiredModule: 'inventory',
    requiresPosContext: true
  },
  {
    id: 'payment-methods',
    label: 'Medios de pago',
    requiredPermissions: ['settings:manage']
  },
  {
    id: 'qr-menu',
    label: 'Menú Digital (QR)',
    requiredPermissions: ['tenant:settings:manage'],
    requiredModule: 'qr_menu'
  }
] as const;
