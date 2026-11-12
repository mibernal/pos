import { describe, it, expect } from 'vitest';
import {
  ASSIGNABLE_MODULES,
  MODULE_COLUMN,
  MODULE_DTO_FIELD,
  moduleColumnToDtoField,
  moduleFlags,
  modulesFromFlags,
  modulesFromRow,
  type AssignableModule
} from '../src/index.js';

/**
 * El mapa de módulos es uno solo.
 *
 * Esta prueba es la red de PL-07: la lista se escribía tres veces —columnas, DTO y una
 * cadena de `if` en el frontend— y al divergir el comercio veía menús que no podía usar.
 * Ahora se deriva de `ASSIGNABLE_MODULES`, y lo que queda por vigilar es que la derivación
 * no cambie de nombre por accidente.
 */

describe('Mapa de módulos', () => {
  /**
   * Los nombres van escritos aquí a propósito.
   *
   * `MODULE_DTO_FIELD` los calcula, y un nombre calculado no se puede buscar en el código:
   * quien busque `enableWaiterShifts` tiene que encontrarlo en algún sitio, y ese sitio es
   * este. Renombrar una columna rompe esta prueba antes de romper una pantalla.
   */
  const ESPERADOS: Record<AssignableModule, string> = {
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
  };

  it('el campo del DTO se deriva de la columna, y los nombres son los de siempre', () => {
    expect(MODULE_DTO_FIELD).toEqual(ESPERADOS);
  });

  /**
   * La que sostiene todo: el mapa está escrito a mano para que el tipo conserve los nombres,
   * y esta comprobación es lo que impide que se separe de las columnas. Renombrar una columna
   * rompe aquí, no en una pantalla.
   */
  it('cada campo del DTO es exactamente la versión camelCase de su columna', () => {
    for (const module of ASSIGNABLE_MODULES) {
      expect(MODULE_DTO_FIELD[module]).toBe(moduleColumnToDtoField(MODULE_COLUMN[module]));
    }
  });

  it('cada módulo asignable tiene columna y campo, sin sobras ni faltas', () => {
    expect(Object.keys(MODULE_COLUMN).sort()).toEqual([...ASSIGNABLE_MODULES].sort());
    expect(Object.keys(MODULE_DTO_FIELD).sort()).toEqual([...ASSIGNABLE_MODULES].sort());
  });

  it('ida y vuelta: los módulos sobreviven al viaje por el DTO', () => {
    const algunos: AssignableModule[] = ['tables', 'tips', 'waiter_shifts', 'qr_menu'];
    expect(modulesFromFlags(moduleFlags(algunos)).sort()).toEqual([...algunos].sort());
  });

  it('lo que no está encendido no viaja', () => {
    const banderines = moduleFlags(['tips']);
    expect(banderines.enableTips).toBe(true);
    expect(banderines.enableTables).toBe(false);
    expect(modulesFromFlags(banderines)).toEqual(['tips']);
  });

  it('una fila de tenant declara los mismos módulos que su DTO', () => {
    // Es el recorrido real: fila → DTO → frontend. Si las dos mitades divergieran, esta
    // igualdad se rompería.
    const fila: Record<string, unknown> = { enable_tables: true, enable_tips: true, enable_kds: false };
    expect(modulesFromFlags(moduleFlags(modulesFromRow(fila)))).toEqual(modulesFromRow(fila));
    expect(modulesFromRow(fila).sort()).toEqual(['tables', 'tips']);
  });

  it('una fila vacía no enciende nada', () => {
    expect(modulesFromRow({})).toEqual([]);
    expect(modulesFromRow(null)).toEqual([]);
    expect(modulesFromFlags(undefined)).toEqual([]);
  });
});
