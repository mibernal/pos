import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  adminDb,
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  grantLimits,
  grantModules,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

/**
 * Identidad del mesero y turnos.
 *
 * Tres cosas que no existían. El PIN del mesero se guardaba hasheado, se exigía único por
 * sucursal y **nada lo verificaba nunca**: aquí es con lo que entra a su turno. La ficha de
 * personal podía quedar ligada a la cuenta de otro comercio, y un mesero que entraba con su
 * propia cuenta dejaba sus ventas sin atribuir. Y `enable_waiter_shifts` era un interruptor
 * sin nada detrás.
 */

describe('Turnos de mesero', () => {
  let app: FastifyInstance;
  const fixtures: E2eFixture[] = [];

  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    for (const fixture of fixtures.reverse()) {
      await cleanupE2eFixture(app, fixture);
    }
    await app.close();
  });

  /**
   * `waiters` vale 0 en el plan STARTER que siembra la fixture — el catálogo siempre lo dijo
   * y hasta ahora nadie lo aplicaba. El cupo se fija **antes** de la primera petición: el
   * resolutor de entitlements cachea, y cambiarlo a mitad de escenario probaría la caché en
   * vez de la cuota.
   */
  async function escenario(limiteMeseros = 5) {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await grantModules(fixture.tenantId, ['waiters', 'waiter_shifts', 'tips', 'tables']);

    await grantLimits(fixture.tenantId, { waiters: limiteMeseros });

    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    const turnoCaja = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(token),
      payload: {
        branch_id: fixture.branchId,
        terminal_id: fixture.terminalId,
        opening_amount_cents: 0
      }
    });
    expect(turnoCaja.statusCode).toBe(201);

    return { fixture, token, sessionId: turnoCaja.json().cash_session.id as string };
  }

  async function crearMesero(
    fixture: E2eFixture,
    token: string,
    payload: { name: string; pin?: string; user_id?: string }
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/branches/${fixture.branchId}/waiters`,
      headers: bearerHeaders(token),
      payload
    });
  }

  function abrirTurno(token: string, payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/waiter-shifts/open',
      headers: bearerHeaders(token),
      payload
    });
  }

  it('el mesero entra con su PIN', async () => {
    const { fixture, token, sessionId } = await escenario();

    const mesero = await crearMesero(fixture, token, { name: 'Ana', pin: '4821' });
    expect(mesero.statusCode).toBe(201);
    // El PIN nunca sale en la respuesta: solo si lo tiene.
    expect(mesero.json().has_pin).toBe(true);
    expect(JSON.stringify(mesero.json())).not.toContain('4821');

    const abierto = await abrirTurno(token, {
      branch_id: fixture.branchId,
      pin: '4821',
      cash_session_id: sessionId
    });

    expect(abierto.statusCode).toBe(201);
    expect(abierto.json().waiter_id).toBe(mesero.json().id);
    expect(abierto.json().waiter_name).toBe('Ana');

    const malPin = await abrirTurno(token, { branch_id: fixture.branchId, pin: '0000' });
    expect(malPin.statusCode).toBe(401);
    expect(malPin.json().error?.code ?? malPin.json().code).toBe('WAITER_PIN_INVALID');
  });

  it('no deja dos turnos abiertos del mismo mesero', async () => {
    const { fixture, token } = await escenario();
    await crearMesero(fixture, token, { name: 'Beto', pin: '5150' });

    expect((await abrirTurno(token, { branch_id: fixture.branchId, pin: '5150' })).statusCode).toBe(201);

    const segundo = await abrirTurno(token, { branch_id: fixture.branchId, pin: '5150' });
    expect(segundo.statusCode).toBe(409);
    expect(segundo.json().error?.code ?? segundo.json().code).toBe('WAITER_SHIFT_ALREADY_OPEN');
  });

  it('atribuye la venta al mesero que entró con su propia cuenta', async () => {
    const { fixture, token, sessionId } = await escenario();

    // La ficha del cajero de la fixture, ligada a su cuenta.
    const mesero = await crearMesero(fixture, token, { name: 'Cajero-Mesero', user_id: fixture.cashierUserId });
    expect(mesero.statusCode).toBe(201);

    const tokenCajero = await loginE2eUser(app, {
      email: fixture.cashierEmail,
      password: fixture.cashierPassword
    });

    // Un cajero no puede vender en una caja que abrió otro, así que la caja del escenario se
    // cierra y él abre la suya.
    await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${sessionId}/close`,
      headers: bearerHeaders(token),
      payload: { closing_cash_real_cents: 0 }
    });

    const cajaPropia = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(tokenCajero),
      payload: { branch_id: fixture.branchId, terminal_id: fixture.terminalId, opening_amount_cents: 0 }
    });
    expect(cajaPropia.statusCode).toBe(201);
    const sesionCajero = cajaPropia.json().cash_session.id as string;

    // La pantalla no manda `waiterId`: nadie lo eligió en el selector.
    const venta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(tokenCajero),
      payload: {
        client_uuid: randomUUID(),
        branch_id: fixture.branchId,
        cash_session_id: sesionCajero,
        items: [{ product_id: fixture.productId, qty: 1 }],
        discount_cents: 0,
        payments: [{ method: 'CASH', amount_cents: fixture.productPriceCents }]
      }
    });

    expect(venta.statusCode).toBe(201);

    const fila = await adminDb()
      .selectFrom('sales')
      .select('waiter_id')
      .where('tenant_id', '=', fixture.tenantId)
      .where('id', '=', venta.json().sale.id)
      .executeTakeFirstOrThrow();

    expect(fila.waiter_id).toBe(mesero.json().id);
  });

  it('rechaza atribuir la venta a un mesero de otro comercio', async () => {
    const propio = await escenario();
    const ajeno = await escenario();

    const meseroAjeno = await crearMesero(ajeno.fixture, ajeno.token, { name: 'De otro local' });
    expect(meseroAjeno.statusCode).toBe(201);

    const venta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(propio.token),
      payload: {
        client_uuid: randomUUID(),
        branch_id: propio.fixture.branchId,
        cash_session_id: propio.sessionId,
        items: [{ product_id: propio.fixture.productId, qty: 1 }],
        discount_cents: 0,
        waiterId: meseroAjeno.json().id,
        payments: [{ method: 'CASH', amount_cents: propio.fixture.productPriceCents }]
      }
    });

    // La clave foránea solo exige que el mesero exista, y no pasa por RLS: sin la
    // comprobación explícita esta venta se habría creado con el mesero del vecino.
    expect(venta.statusCode).toBe(404);
    expect(venta.json().error?.code ?? venta.json().code).toBe('WAITER_NOT_FOUND');
  });

  it('no liga la ficha a una cuenta de otro comercio', async () => {
    const propio = await escenario();
    const ajeno = await escenario();

    const respuesta = await crearMesero(propio.fixture, propio.token, {
      name: 'Con cuenta ajena',
      user_id: ajeno.fixture.cashierUserId
    });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json().error?.code ?? respuesta.json().code).toBe('USER_NOT_FOUND');
  });

  it('respeta la cuota de meseros del plan', async () => {
    const { fixture, token } = await escenario(1);

    expect((await crearMesero(fixture, token, { name: 'Primero' })).statusCode).toBe(201);

    const segundo = await crearMesero(fixture, token, { name: 'Segundo' });
    expect(segundo.statusCode).toBe(403);
    expect(segundo.json().error?.code ?? segundo.json().code).toBe('QUOTA_EXCEEDED');
  });

  it('el corte del turno cuadra y se congela al cerrar', async () => {
    const { fixture, token, sessionId } = await escenario();

    const mesero = await crearMesero(fixture, token, { name: 'Dina', pin: '7788' });
    const abierto = await abrirTurno(token, {
      branch_id: fixture.branchId,
      pin: '7788',
      cash_session_id: sessionId
    });
    const shiftId = abierto.json().id as string;

    const precio = fixture.productPriceCents;
    const propina = 10_000;

    // Mitad en efectivo, mitad con tarjeta: la propina se parte igual, y el corte tiene que
    // distinguir la que está en el cajón —que se le puede entregar al salir— de la que
    // cobró el comercio.
    const venta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(token),
      payload: {
        client_uuid: randomUUID(),
        branch_id: fixture.branchId,
        cash_session_id: sessionId,
        items: [{ product_id: fixture.productId, qty: 1 }],
        discount_cents: 0,
        tip_cents: propina,
        waiterId: mesero.json().id,
        payments: [
          { method: 'CASH', amount_cents: Math.floor((precio + propina) / 2) },
          {
            method: 'CARD',
            amount_cents: precio + propina - Math.floor((precio + propina) / 2),
            approval_code: '123456'
          }
        ]
      }
    });
    expect(venta.statusCode).toBe(201);

    const enCurso = await app.inject({
      method: 'GET',
      url: `/api/v1/waiter-shifts/${shiftId}/summary`,
      headers: bearerHeaders(token)
    });

    expect(enCurso.statusCode).toBe(200);
    expect(enCurso.json().sales_count).toBe(1);
    expect(enCurso.json().sales_total_cents).toBe(precio + propina);
    expect(enCurso.json().tips_total_cents).toBe(propina);
    expect(enCurso.json().tips_cash_cents + enCurso.json().tips_electronic_cents).toBe(propina);
    expect(enCurso.json().tips_cash_cents).toBeGreaterThan(0);
    expect(enCurso.json().tips_electronic_cents).toBeGreaterThan(0);

    const cerrado = await app.inject({
      method: 'POST',
      url: `/api/v1/waiter-shifts/${shiftId}/close`,
      headers: bearerHeaders(token),
      payload: {}
    });

    expect(cerrado.statusCode).toBe(200);
    expect(cerrado.json().tips_total_cents).toBe(propina);
    expect(cerrado.json().closed_at).not.toBeNull();

    // Anular la venta después no reescribe el papel que el mesero se llevó a casa.
    await adminDb()
      .updateTable('sales')
      .set({
        status: 'VOID',
        void_reason: 'Prueba de que el corte no se recalcula',
        voided_by_user_id: fixture.adminUserId,
        voided_at: new Date()
      })
      .where('id', '=', venta.json().sale.id)
      .execute();

    const congelado = await app.inject({
      method: 'GET',
      url: `/api/v1/waiter-shifts/${shiftId}/summary`,
      headers: bearerHeaders(token)
    });

    expect(congelado.json().tips_total_cents).toBe(propina);
    expect(congelado.json().sales_count).toBe(1);
  });
});
