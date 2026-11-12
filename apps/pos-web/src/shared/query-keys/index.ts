/**
 * Las claves de las consultas, en un solo sitio.
 *
 * Cubrían tres dominios; el resto de la aplicación las escribía a mano en cada archivo
 * (`['rooms', branchId]`, `['kds-tickets', branchId]`…). Eso no es un problema de estilo:
 * una clave es un contrato entre quien consulta y quien invalida, y escrita a mano en dos
 * archivos distintos se puede escribir mal en uno solo. Pasaba: enviar un curso a cocina
 * invalidaba `['kitchen-tickets', branchId]`, una clave que no consulta nadie —el KDS lee
 * `['kds-tickets', branchId]`—, así que el tablero solo se refrescaba si el socket llegaba
 * a tiempo. Un fallo invisible, imposible de ver leyendo cualquiera de los dos archivos por
 * separado.
 *
 * Con las claves derivadas de aquí, esa clase de error deja de poder escribirse.
 *
 * Forma: primero el ámbito —`tenant`, `branch`, `platform` o `public`—, luego el dominio.
 * Así `invalidateQueries({ queryKey: ['branch', id] })` alcanza todo lo de una sucursal, y
 * un cambio de comercio no deja migas del anterior.
 */

type Id = string | null | undefined;

const tenant = (tenantId: Id, ...resto: readonly (string | number)[]) =>
  ['tenant', tenantId, ...resto] as const;

const branch = (branchId: Id, ...resto: readonly (string | number)[]) =>
  ['branch', branchId, ...resto] as const;

/** Usuarios y sucursales del comercio. */
export const userKeys = {
  all: (tenantId: Id) => tenant(tenantId, 'users'),
  branches: (tenantId: Id) => tenant(tenantId, 'branches')
};

/** Catálogo, existencias y sus conciliaciones. */
export const inventoryKeys = {
  products: (tenantId: Id, branchId?: Id) =>
    (branchId ? tenant(tenantId, 'products', branchId) : tenant(tenantId, 'products')),
  balances: (tenantId: Id, branchId?: Id) =>
    (branchId ? tenant(tenantId, 'balances', branchId) : tenant(tenantId, 'balances')),
  consolidatedInventory: (tenantId: Id) => tenant(tenantId, 'consolidatedInventory'),
  expectedReconciliation: (tenantId: Id, entityId: string, entityType: string) =>
    tenant(tenantId, 'expected', entityId, entityType),
  recipes: (tenantId: Id) => tenant(tenantId, 'recipes'),
  recipe: (tenantId: Id, productId: string) => tenant(tenantId, 'recipes', productId),
  bulkImportJob: (tenantId: Id, jobId: string) => tenant(tenantId, 'bulk-import', jobId)
};

/** Consola de plataforma. Vive fuera del comercio: no lleva `tenantId` de sesión. */
export const platformKeys = {
  dashboard: () => ['platform', 'dashboard'] as const,
  activity: () => ['platform', 'activity'] as const,
  growth: () => ['platform', 'growth'] as const,
  health: () => ['platform', 'health'] as const,
  // El directorio se filtra por texto y por estado a la vez, así que la clave acepta el
  // objeto de filtros completo —como `reportKeys`— y no solo el término de búsqueda.
  tenants: (filtros?: string | Readonly<Record<string, unknown>>) =>
    (filtros
      ? (['platform', 'tenants', typeof filtros === 'string' ? filtros : JSON.stringify(filtros)] as const)
      : (['platform', 'tenants'] as const)),
  tenantUsage: (tenantId: string) => ['platform', 'tenant-usage', tenantId] as const,
  plans: () => ['platform', 'plans'] as const,
  planEntitlements: (planId: string) => ['platform', 'plan-entitlements', planId] as const,
  tenantUsers: (tenantId?: Id) =>
    (tenantId ? (['platform', 'tenant-users', tenantId] as const) : (['platform', 'tenant-users'] as const)),
  revenue: () => ['platform', 'revenue'] as const
};

/** Salón: salas, mesas, la cuenta abierta de cada mesa y las reservas. */
export const tableKeys = {
  rooms: (branchId: Id) => branch(branchId, 'rooms'),
  order: (branchId: Id, tableId: Id) => ['branch', branchId, 'table-order', tableId] as const,
  reservations: (branchId: Id, desde?: string, hasta?: string) =>
    (desde && hasta ? branch(branchId, 'reservations', desde, hasta) : branch(branchId, 'reservations'))
};

/** Meseros y sus turnos. */
export const waiterKeys = {
  all: (branchId: Id) => branch(branchId, 'waiters'),
  shifts: (branchId: Id) => branch(branchId, 'waiter-shifts'),
  shiftSummary: (shiftId: Id) => ['waiter-shift-summary', shiftId] as const
};

/** Tablero de cocina. */
export const kdsKeys = {
  tickets: (branchId: Id) => branch(branchId, 'kds-tickets')
};

/** Domicilios. */
export const deliveryKeys = {
  all: (branchId: Id) => branch(branchId, 'deliveries'),
  one: (branchId: Id, deliveryId: string) => branch(branchId, 'deliveries', deliveryId),
  persons: (branchId: Id) => branch(branchId, 'delivery-persons')
};

/** Caja: terminales y la sesión abierta de cada una. */
export const cashKeys = {
  terminals: (branchId: Id) => branch(branchId, 'terminals'),
  currentSession: (terminalId: Id) => ['terminal', terminalId, 'cash-session'] as const
};

/** Ventas ya cerradas: historial y su detalle. */
export const salesKeys = {
  list: (tenantId: Id, filtros?: Readonly<Record<string, unknown>>) =>
    (filtros ? tenant(tenantId, 'sales', JSON.stringify(filtros)) : tenant(tenantId, 'sales')),
  detail: (tenantId: Id, saleId: string) => tenant(tenantId, 'sales', saleId)
};

/** Clientes y lo que deben. */
export const customerKeys = {
  all: (tenantId: Id) => tenant(tenantId, 'customers'),
  receivables: (tenantId: Id) => tenant(tenantId, 'receivables'),
  statement: (tenantId: Id, customerId: string) => tenant(tenantId, 'statement', customerId)
};

/** Promociones. */
export const promotionKeys = {
  all: (tenantId: Id, branchId?: Id) =>
    (branchId ? tenant(tenantId, 'promotions', branchId) : tenant(tenantId, 'promotions'))
};

/** Informes y auditoría. Llevan sus filtros en la clave: cambiarlos es otra consulta. */
export const reportKeys = {
  sales: (tenantId: Id, filtros: Readonly<Record<string, unknown>>) =>
    tenant(tenantId, 'report-sales', JSON.stringify(filtros)),
  waiters: (tenantId: Id, filtros: Readonly<Record<string, unknown>>) =>
    tenant(tenantId, 'report-waiters', JSON.stringify(filtros)),
  operations: (tenantId: Id, filtros: Readonly<Record<string, unknown>>) =>
    tenant(tenantId, 'report-operations', JSON.stringify(filtros)),
  audit: (tenantId: Id, filtros: Readonly<Record<string, unknown>>) =>
    tenant(tenantId, 'audit-logs', JSON.stringify(filtros))
};

/** Facturación del propio comercio: su plan, sus facturas y su medio de pago. */
export const billingKeys = {
  portal: (tenantId: Id) => tenant(tenantId, 'billing-portal'),
  plans: () => ['billing', 'plans'] as const
};

/** Configuración del comercio. */
export const settingsKeys = {
  tenantProfile: (tenantId: Id) => tenant(tenantId, 'profile'),
  ticketTemplate: (tenantId: Id) => tenant(tenantId, 'ticket-template'),
  paymentMethods: (tenantId: Id) => tenant(tenantId, 'payment-methods'),
  paymentMethodCatalog: () => ['payment-method-catalog'] as const,
  tipSettings: (tenantId: Id) => tenant(tenantId, 'tip-settings'),
  tableQr: (branchId: Id) => branch(branchId, 'table-qr')
};

/** Avisos operativos. */
export const alertKeys = {
  all: (tenantId: Id) => tenant(tenantId, 'alerts')
};

/**
 * La carta pública y la mesa por QR.
 *
 * No hay sesión: la clave la define el token del QR, no el comercio.
 */
export const publicKeys = {
  catalog: (slug: string) => ['public', 'catalog', slug] as const,
  qrTable: (token: string) => ['public', 'qr-table', token] as const
};

export const queryKeys = {
  user: userKeys,
  inventory: inventoryKeys,
  platform: platformKeys,
  tables: tableKeys,
  waiters: waiterKeys,
  kds: kdsKeys,
  deliveries: deliveryKeys,
  cash: cashKeys,
  sales: salesKeys,
  customers: customerKeys,
  promotions: promotionKeys,
  reports: reportKeys,
  billing: billingKeys,
  settings: settingsKeys,
  alerts: alertKeys,
  public: publicKeys
};
