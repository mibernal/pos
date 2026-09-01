import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  adminDb,
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  grantModules,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';
import { ASSIGNABLE_MODULES, MODULE_COLUMN, type AssignableModule } from '@pos-dian/shared';

/**
 * Lo que el comercio puede hacer y lo que el frontend le enseña salen de lo mismo.
 *
 * El mapa de módulos vivía escrito en cuatro sitios —columna en `tenants`, claim del JWT,
 * rama del `switch` de `requireModule` y línea del `FeatureModuleProvider`— y nada obligaba
 * a que coincidieran. No coincidían: los seis macro-módulos de la migración 086 se leían
 * pero no se seleccionaban, así que valían siempre `false` (fase 6).
 *
 * Desde la fase 7 la fuente es el plan más las excepciones del comercio, y el token se
 * deriva de ahí. Esta prueba fija esa derivación: si alguien vuelve a construir los claims
 * desde las columnas, o añade un módulo y se olvida de una capa, falla aquí.
 */

let app: FastifyInstance;
const fixtures: E2eFixture[] = [];

/** Nombre del claim que corresponde a cada módulo (`tables` → `enableTables`). */
function claimFor(module: AssignableModule): string {
  return MODULE_COLUMN[module].replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

async function login(email: string, password: string) {
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

describe('Los módulos resueltos llegan completos a la sesión', () => {
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

  it('cada módulo concedido llega encendido, y ninguno más', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    // Se conceden todos a la vez a propósito: si falta uno en la derivación, la comparación
    // lo señala por su nombre en vez de pasar por casualidad.
    await grantModules(fixture.tenantId, ASSIGNABLE_MODULES);

    const session = await login(fixture.adminEmail, fixture.adminPassword);

    const missing = ASSIGNABLE_MODULES.filter((m) => session.user[claimFor(m)] !== true);
    expect(missing).toEqual([]);
  });

  it('revocar un módulo lo apaga en el token sin tocar la columna', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    await grantModules(fixture.tenantId, ['tables', 'waiters', 'tips']);

    // La columna se deja encendida a mano: si el token siguiera saliendo de ella, esta
    // prueba pasaría por el motivo equivocado.
    await adminDb()
      .updateTable('tenants')
      .set({ enable_tables: true, enable_waiters: true, enable_tips: true })
      .where('id', '=', fixture.tenantId)
      .execute();

    await adminDb()
      .updateTable('tenant_module_overrides')
      .set({ enabled: false })
      .where('tenant_id', '=', fixture.tenantId)
      .where('module', '=', 'waiters')
      .execute();

    const session = await login(fixture.adminEmail, fixture.adminPassword);

    expect(session.user.enableTables).toBe(true);
    expect(session.user.enableTips).toBe(true);
    expect(session.user.enableWaiters).toBe(false);
  });

  it('el login y /auth/me dicen lo mismo', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    await grantModules(fixture.tenantId, ['tables', 'kds', 'qr_menu']);

    const session = await login(fixture.adminEmail, fixture.adminPassword);

    // `/auth/me` reconstruye la sesión por otra consulta. La deriva entre las dos es el
    // defecto que la fase 6 encontró y que la 7 hace imposible por construcción.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearerHeaders(session.accessToken)
    });

    expect(me.statusCode).toBe(200);
    const meUser = me.json().user as Record<string, unknown>;

    const disagreements = ASSIGNABLE_MODULES.filter((m) => meUser[claimFor(m)] !== session.user[claimFor(m)]).map(
      (m) => `${m}: login=${String(session.user[claimFor(m)])} me=${String(meUser[claimFor(m)])}`
    );

    expect(disagreements).toEqual([]);
  });
});
