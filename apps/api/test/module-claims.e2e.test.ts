import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  adminDb,
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

/** Login que devuelve el cuerpo completo, no solo el token: aquí se comprueba el DTO. */
async function login(app: FastifyInstance, email: string, password: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password }
  });

  if (response.statusCode !== 200) {
    throw new Error(`Login fallido: ${response.statusCode} ${response.body}`);
  }

  return response.json() as { accessToken: string; user: Record<string, unknown> };
}

/**
 * Los módulos del comercio tienen que llegar completos al token.
 *
 * El mapa de módulos vive escrito cuatro veces: como columna en `tenants`, como claim del
 * JWT, como rama del `switch` de `requireModule` y como línea del `FeatureModuleProvider`
 * del frontend. Nada obligaba a que las cuatro coincidieran, y no coincidían: los seis
 * macro-módulos de la migración 086 se leían en `buildAuthClaims` pero no se seleccionaban
 * en ninguna de las dos consultas de autenticación, así que valían siempre `false`.
 *
 * Esta prueba compara lo que dice la base con lo que llega en la sesión, columna por
 * columna. Si alguien añade un módulo y se olvida de una capa, falla aquí.
 */

let app: FastifyInstance;
const fixtures: E2eFixture[] = [];

/** Columna de `tenants` → propiedad del usuario en la respuesta de autenticación. */
const MODULE_COLUMNS = {
  enable_restaurant: 'enableRestaurant',
  enable_kds: 'enableKds',
  enable_inventory: 'enableInventory',
  enable_fiscal: 'enableFiscal',
  enable_loyalty: 'enableLoyalty',
  enable_advanced_reports: 'enableAdvancedReports',
  enable_tables: 'enableTables',
  enable_delivery: 'enableDelivery',
  enable_waiters: 'enableWaiters',
  enable_split_bill: 'enableSplitBill',
  enable_tips: 'enableTips',
  enable_kitchen: 'enableKitchen',
  enable_kitchen_display: 'enableKitchenDisplay',
  enable_kitchen_tickets: 'enableKitchenTickets',
  enable_kitchen_printing: 'enableKitchenPrinting',
  enable_order_rounds: 'enableOrderRounds',
  enable_product_modifiers: 'enableProductModifiers',
  enable_reservations: 'enableReservations',
  enable_waiter_shifts: 'enableWaiterShifts',
  enable_qr_menu: 'enableQrMenu',
  enable_guests_count: 'enableGuestsCount'
} as const;

describe('Los módulos del comercio llegan completos a la sesión', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    for (const fixture of fixtures) {
      await cleanupE2eFixture(app, fixture);
    }
    await app.close();
  });

  it('cada módulo encendido en la base llega encendido al iniciar sesión', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    // Se encienden todos a la vez a propósito: así, si falta uno en la consulta, la
    // comparación lo señala por su nombre en vez de pasar por casualidad.
    const allEnabled = Object.fromEntries(Object.keys(MODULE_COLUMNS).map((column) => [column, true]));

    await adminDb()
      .updateTable('tenants')
      .set(allEnabled as never)
      .where('id', '=', fixture.tenantId)
      .execute();

    const session = await login(app, fixture.adminEmail, fixture.adminPassword);
    const user = session.user;

    const missing = Object.entries(MODULE_COLUMNS)
      .filter(([, claim]) => user[claim] !== true)
      .map(([column, claim]) => `${column} → ${claim}`);

    expect(missing).toEqual([]);
  });

  it('cada módulo apagado en la base llega apagado, y /auth/me dice lo mismo', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    const allDisabled = Object.fromEntries(Object.keys(MODULE_COLUMNS).map((column) => [column, false]));

    await adminDb()
      .updateTable('tenants')
      .set(allDisabled as never)
      .where('id', '=', fixture.tenantId)
      .execute();

    const session = await login(app, fixture.adminEmail, fixture.adminPassword);

    // `/auth/me` reconstruye los claims por otra consulta (`getUserForAuth`). Las dos
    // tienen que decir lo mismo: la deriva entre ellas es justo el defecto que se corrige.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearerHeaders(session.accessToken)
    });

    expect(me.statusCode).toBe(200);
    const meUser = me.json().user as Record<string, unknown>;
    const loginUser = session.user;

    const disagreements = Object.values(MODULE_COLUMNS)
      .filter((claim) => meUser[claim] !== false || loginUser[claim] !== false)
      .map((claim) => `${claim}: login=${String(loginUser[claim])} me=${String(meUser[claim])}`);

    expect(disagreements).toEqual([]);
  });
});
