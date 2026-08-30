import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  adminDb,
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

/**
 * El PIN del mesero y el informe que lo cuenta.
 *
 * Dos defectos distintos con la misma raíz: una capa se movió y las otras se quedaron. El
 * PIN se guardaba en claro y salía en la respuesta de una ruta abierta a cualquier
 * empleado; y el informe de meseros seguía uniendo contra `users` cuando desde la
 * migración 074 `sales.waiter_id` referencia `waiters.id`, además de consultar fuera del
 * contexto de comercio, con lo que RLS lo dejaba vacío en producción.
 */

let app: FastifyInstance;
const fixtures: E2eFixture[] = [];

async function enableWaiters(tenantId: string) {
  await adminDb()
    .updateTable('tenants')
    .set({ enable_restaurant: true, enable_tables: true, enable_waiters: true })
    .where('id', '=', tenantId)
    .execute();
}

async function adminToken(fixture: E2eFixture) {
  return await loginE2eUser(app, { email: fixture.adminEmail, password: fixture.adminPassword });
}

function createWaiter(token: string, branchId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/branches/${branchId}/waiters`,
    headers: bearerHeaders(token),
    payload
  });
}

describe('PIN del mesero', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    for (const fixture of fixtures) {
      await adminDb().deleteFrom('sales').where('tenant_id', '=', fixture.tenantId).execute();
      await adminDb().deleteFrom('cash_sessions').where('tenant_id', '=', fixture.tenantId).execute();
      await adminDb().deleteFrom('waiters').where('tenant_id', '=', fixture.tenantId).execute();
      await cleanupE2eFixture(app, fixture);
    }
    await app.close();
  });

  it('el PIN no viaja nunca en la respuesta, ni en claro ni hasheado', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await enableWaiters(fixture.tenantId);
    const token = await adminToken(fixture);

    const created = await createWaiter(token, fixture.branchId, { name: 'Ana Mesera', pin: '4821' });
    expect(created.statusCode).toBe(201);

    const body = created.json();
    expect(body.has_pin).toBe(true);
    expect(body).not.toHaveProperty('pin');
    expect(body).not.toHaveProperty('pin_hash');

    // La lista es la ruta que estaba abierta a cualquiera con el módulo activo: es la que
    // repartía los PIN de toda la sucursal por la pestaña de red.
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/branches/${fixture.branchId}/waiters`,
      headers: bearerHeaders(token)
    });

    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain('4821');
    expect(list.body).not.toContain('$argon2');
    expect(list.json()[0].has_pin).toBe(true);
  });

  it('el PIN queda guardado como hash Argon2, no como texto', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await enableWaiters(fixture.tenantId);
    const token = await adminToken(fixture);

    await createWaiter(token, fixture.branchId, { name: 'Beto Mesero', pin: '5510' });

    const stored = await adminDb()
      .selectFrom('waiters')
      .select('pin_hash')
      .where('tenant_id', '=', fixture.tenantId)
      .executeTakeFirstOrThrow();

    expect(stored.pin_hash).toMatch(/^\$argon2/);
    expect(stored.pin_hash).not.toContain('5510');
  });

  it('dos meseros de la misma sucursal no pueden compartir PIN', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await enableWaiters(fixture.tenantId);
    const token = await adminToken(fixture);

    await createWaiter(token, fixture.branchId, { name: 'Carla', pin: '7788' });
    const duplicate = await createWaiter(token, fixture.branchId, { name: 'Diego', pin: '7788' });

    // Con el PIN repetido, atribuir una venta o una propina a un mesero deja de probar nada.
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error.code).toBe('PIN_IN_USE');
  });

  it('editar el nombre no borra el PIN, y se puede quitar a propósito', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await enableWaiters(fixture.tenantId);
    const token = await adminToken(fixture);

    const created = await createWaiter(token, fixture.branchId, { name: 'Elena', pin: '3344' });
    const waiterId = created.json().id;

    const renamed = await app.inject({
      method: 'PUT',
      url: `/api/v1/branches/${fixture.branchId}/waiters/${waiterId}`,
      headers: bearerHeaders(token),
      payload: { name: 'Elena Restrepo' }
    });

    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().has_pin).toBe(true);

    const cleared = await app.inject({
      method: 'PUT',
      url: `/api/v1/branches/${fixture.branchId}/waiters/${waiterId}`,
      headers: bearerHeaders(token),
      payload: { pin: null }
    });

    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().has_pin).toBe(false);
  });

  it('no se puede crear un mesero en la sucursal de otro comercio', async () => {
    const own = await seedE2eFixture(app);
    const other = await seedE2eFixture(app);
    fixtures.push(own, other);
    await enableWaiters(own.tenantId);
    const token = await adminToken(own);

    // La política RLS comprueba `tenant_id`, que lo pone el servidor. La sucursal viene en
    // la URL y nadie la estaba validando.
    const response = await createWaiter(token, other.branchId, { name: 'Intruso', pin: '9999' });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);

    const leaked = await adminDb()
      .selectFrom('waiters')
      .select('id')
      .where('branch_id', '=', other.branchId)
      .executeTakeFirst();

    expect(leaked).toBeUndefined();
  });

  it('el informe de meseros resuelve el nombre y devuelve filas', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await enableWaiters(fixture.tenantId);
    const token = await adminToken(fixture);

    const created = await createWaiter(token, fixture.branchId, { name: 'Fernanda Mesera', pin: '1212' });
    const waiterId = created.json().id;

    const cashSessionId = randomUUID();
    await adminDb()
      .insertInto('cash_sessions')
      .values({
        id: cashSessionId,
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        terminal_id: fixture.terminalId,
        opened_by_user_id: fixture.adminUserId,
        opening_amount_cents: 0,
        status: 'OPEN'
      })
      .execute();

    await adminDb()
      .insertInto('sales')
      .values({
        id: randomUUID(),
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        cash_session_id: cashSessionId,
        sale_number: 1,
        status: 'COMPLETED',
        // `ck_sales_total_formula`: total = subtotal - descuento + propina.
        subtotal_cents: 100000,
        total_cents: 105000,
        tip_cents: 5000,
        waiter_id: waiterId,
        created_by_user_id: fixture.adminUserId,
        client_uuid: randomUUID(),
        payment_json: {
          mode: 'CASH',
          total_cents: 105000,
          amounts: { cash_cents: 105000, card_cents: 0, transfer_cents: 0 },
          payments: [{ method: 'CASH', amount_cents: 105000 }]
        } as never
      })
      .execute();

    const report = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/waiters?branch_id=${fixture.branchId}`,
      headers: bearerHeaders(token)
    });

    expect(report.statusCode).toBe(200);
    const items = report.json().items as Array<{ waiter_name: string; total_tips_cents: number }>;

    // Antes: cero filas (la consulta iba fuera del contexto de comercio y RLS la vaciaba) y,
    // de haber devuelto alguna, «Sin Mesero Asignado» por unir contra la tabla equivocada.
    expect(items).toHaveLength(1);
    expect(items[0]!.waiter_name).toBe('Fernanda Mesera');
    expect(Number(items[0]!.total_tips_cents)).toBe(5000);
  });
});
