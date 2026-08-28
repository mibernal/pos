import type { AuthSession } from '../../src/lib/api';

type AuthUser = AuthSession['user'];

/**
 * Construye un `AuthUser` completo para tests.
 *
 * `authUserSchema` declara los feature flags con `.optional().default(false)`, así que
 * el tipo *de salida* (el que usa la app) los exige todos. Los tests solo se preocupan
 * por uno o dos flags, de modo que este helper aporta el resto en `false` y evita que
 * añadir un módulo nuevo rompa cada fixture del proyecto.
 */
export function buildAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    taxMode: 'IVA',
    role: 'ADMIN',
    email: 'admin@demo.posdian.local',
    name: 'Admin Demo',
    active: true,
    enableTables: false,
    enableDelivery: false,
    enableWaiters: false,
    enableSplitBill: false,
    enableTips: false,
    enableKitchen: false,
    enableKitchenDisplay: false,
    enableKitchenTickets: false,
    enableKitchenPrinting: false,
    enableOrderRounds: false,
    enableProductModifiers: false,
    enableReservations: false,
    enableWaiterShifts: false,
    enableQrMenu: false,
    enableGuestsCount: true,
    enableRestaurant: false,
    enableKds: false,
    enableInventory: false,
    enableFiscal: false,
    enableLoyalty: false,
    enableAdvancedReports: false,
    ...overrides
  };
}
