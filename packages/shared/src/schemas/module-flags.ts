import { ASSIGNABLE_MODULES, MODULE_COLUMN, type AssignableModule } from './entitlements.js';

/**
 * Un solo mapa de módulos para las dos mitades.
 *
 * El mismo conjunto se escribía cuatro veces: las columnas `enable_*` de la fila, los campos
 * `enableX` del DTO, los mismos otra vez en los claims del token, y —en el frontend—
 * veintiuna líneas de `if (user.enableX) modules.push('x')` sobre un `as any`. Cuatro listas
 * que había que acordarse de tocar juntas, y que al divergir producen el peor fallo de este
 * sistema: un comercio viendo menús que no puede usar, o dejando de ver los que sí.
 *
 * Aquí queda una sola lista de verdad —`ASSIGNABLE_MODULES`— y todo lo demás se deriva.
 */

/**
 * Campo del DTO de sesión que corresponde a cada módulo.
 *
 * Escrito a mano **a propósito**, y no calculado con un `replace` sobre la columna. Calcularlo
 * tenía dos costes: el tipo perdía los nombres —`AuthUser` se quedaba sin `enableTables` y
 * con él la comprobación de tipos de veinte pantallas— y el nombre dejaba de poder buscarse
 * en el código. La prueba de este archivo comprueba que cada valor es exactamente la versión
 * camelCase de su columna, así que renombrar una columna rompe la prueba antes que una
 * pantalla. Una lista escrita a mano y verificada por máquina es mejor que dos derivadas
 * que nadie compara.
 */
export const MODULE_DTO_FIELD = {
  restaurant: 'enableRestaurant',
  kds: 'enableKds',
  inventory: 'enableInventory',
  fiscal: 'enableFiscal',
  loyalty: 'enableLoyalty',
  advanced_reports: 'enableAdvancedReports',
  tables: 'enableTables',
  delivery: 'enableDelivery',
  waiters: 'enableWaiters',
  split_bill: 'enableSplitBill',
  tips: 'enableTips',
  kitchen: 'enableKitchen',
  kitchen_display: 'enableKitchenDisplay',
  kitchen_tickets: 'enableKitchenTickets',
  kitchen_printing: 'enableKitchenPrinting',
  order_rounds: 'enableOrderRounds',
  product_modifiers: 'enableProductModifiers',
  reservations: 'enableReservations',
  waiter_shifts: 'enableWaiterShifts',
  qr_menu: 'enableQrMenu',
  guests_count: 'enableGuestsCount'
} as const satisfies Record<AssignableModule, string>;

export type ModuleDtoField = (typeof MODULE_DTO_FIELD)[AssignableModule];

/** `enable_waiter_shifts` → `enableWaiterShifts`. Solo lo usa la prueba que vigila el mapa. */
export function moduleColumnToDtoField(columna: string): string {
  return columna.replace(/_([a-z])/g, (_, letra: string) => letra.toUpperCase());
}

/** Los módulos que declara una fila de `tenants` (o un usuario con esas columnas encima). */
export function modulesFromRow(row: Record<string, unknown> | null | undefined): AssignableModule[] {
  if (!row) return [];
  return ASSIGNABLE_MODULES.filter((module) => row[MODULE_COLUMN[module]] === true);
}

/** Los banderines camelCase del DTO, a partir de la lista de módulos. */
export function moduleFlags(modules: readonly AssignableModule[]): Record<ModuleDtoField, boolean> {
  const activos = new Set(modules);
  return Object.fromEntries(
    ASSIGNABLE_MODULES.map((module) => [MODULE_DTO_FIELD[module], activos.has(module)])
  ) as Record<ModuleDtoField, boolean>;
}

/**
 * Los módulos que declara un DTO de sesión.
 *
 * Es la vuelta de `moduleFlags`, y existe para que el frontend no tenga que conocer ningún
 * nombre de campo: le basta con este archivo.
 */
export function modulesFromFlags(dto: Record<string, unknown> | null | undefined): AssignableModule[] {
  if (!dto) return [];
  return ASSIGNABLE_MODULES.filter((module) => dto[MODULE_DTO_FIELD[module]] === true);
}
