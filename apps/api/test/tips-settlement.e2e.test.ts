import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import { allocateTip, splitPool } from '@pos-dian/shared';
import {
  adminDb,
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  grantModules,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

/**
 * Liquidación de propinas.
 *
 * `tip_cents` existía desde la migración 063 y su único lector era un `SUM` del informe de
 * meseros. Lo que se fija aquí es lo que venía después y no existía: repartirla entre los
 * medios de pago, distinguir la que está en el cajón de la que cobró el comercio, y —lo que
 * descuadraba arqueos— sacar del cajón la propina en efectivo con su movimiento de caja.
 */

describe('Propinas', () => {
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

  async function escenario(precioCents: number) {
    const fixture = await seedE2eFixture(app, { productPriceCents: precioCents });
    fixtures.push(fixture);
    await grantModules(fixture.tenantId, ['tables', 'waiters', 'tips']);

    const token = await loginE2eUser(app, { email: fixture.adminEmail, password: fixture.adminPassword });

    const turno = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(token),
      payload: { branch_id: fixture.branchId, terminal_id: fixture.terminalId, opening_amount_cents: 0 }
    });
    expect(turno.statusCode).toBe(201);

    return { fixture, token, sessionId: turno.json().cash_session.id as string };
  }

  async function nuevoMesero(fixture: E2eFixture, nombre: string) {
    const id = randomUUID();
    await adminDb()
      .insertInto('waiters')
      .values({
        id,
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        name: nombre,
        is_active: true
      })
      .execute();
    return id;
  }

  function venta(
    fixture: E2eFixture,
    token: string,
    sessionId: string,
    payments: unknown[],
    tipCents: number,
    waiterId?: string
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(token),
      payload: {
        client_uuid: randomUUID(),
        branch_id: fixture.branchId,
        cash_session_id: sessionId,
        items: [{ product_id: fixture.productId, qty: 1 }],
        discount_cents: 0,
        tip_cents: tipCents,
        ...(waiterId ? { waiterId } : {}),
        payments
      }
    });
  }

  it('reparte la propina entre los medios de la venta, en proporción a lo pagado', async () => {
    const { fixture, token, sessionId } = await escenario(100000);
    const precio = fixture.productPriceCents;
    const propina = 20000;
    const total = precio + propina;

    // Mitad y mitad: la propina se parte igual.
    const respuesta = await venta(
      fixture,
      token,
      sessionId,
      [
        { method: 'CASH', amount_cents: Math.floor(total / 2) },
        { method: 'CARD', amount_cents: total - Math.floor(total / 2), approval_code: '123456' }
      ],
      propina
    );

    expect(respuesta.statusCode).toBe(201);

    const pagos = await adminDb()
      .selectFrom('sale_payments')
      .select(['kind', 'amount_cents', 'tip_cents'])
      .where('tenant_id', '=', fixture.tenantId)
      .orderBy('kind', 'asc')
      .execute();

    expect(pagos).toHaveLength(2);
    // La suma del reparto es exactamente la propina de la venta: ni un peso perdido al
    // redondear, que es lo que ocurre al dividir y truncar sin colocar el sobrante.
    expect(pagos.reduce((suma, pago) => suma + pago.tip_cents, 0)).toBe(propina);
    expect(pagos.every((pago) => pago.tip_cents > 0)).toBe(true);
  }, 90_000);

  it('paga la propina en efectivo con su movimiento de caja y el turno cuadra', async () => {
    const { fixture, token, sessionId } = await escenario(50000);
    const precio = fixture.productPriceCents;
    const propina = 10000;

    const mesero = await nuevoMesero(fixture, 'Andrés');

    const creada = await venta(
      fixture,
      token,
      sessionId,
      [{ method: 'CASH', amount_cents: precio + propina }],
      propina,
      mesero
    );
    expect(creada.statusCode).toBe(201);

    const resumen = await app.inject({
      method: 'GET',
      url: `/api/v1/cash-sessions/${sessionId}/tips`,
      headers: bearerHeaders(token)
    });

    expect(resumen.statusCode).toBe(200);
    expect(resumen.json().total_cents).toBe(propina);
    expect(resumen.json().cash_cents).toBe(propina);
    expect(resumen.json().shares[0].waiter_name).toBe('Andrés');
    expect(resumen.json().settled).toBe(false);

    const liquidacion = await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${sessionId}/tips/settle`,
      headers: bearerHeaders(token),
      payload: { pay_cash_now: true }
    });

    expect(liquidacion.statusCode).toBe(201);
    expect(liquidacion.json().cash_movement_id).not.toBeNull();

    /**
     * El cierre: entraron precio + propina en efectivo, y salieron del cajón los 10.000 de
     * propina que se llevó Andrés. Sin el movimiento de caja, el cajero contaría el precio
     * y el sistema esperaría precio + propina: un faltante exacto del tamaño de la propina,
     * cada noche.
     */
    const cierre = await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${sessionId}/close`,
      headers: bearerHeaders(token),
      payload: { closing_cash_real_cents: precio }
    });

    expect(cierre.statusCode).toBe(200);
    expect(cierre.json().summary.expected_cash_cents).toBe(precio);
    expect(cierre.json().summary.diff_cents).toBe(0);
  }, 90_000);

  it('no saca del cajón la propina cobrada con tarjeta', async () => {
    const { fixture, token, sessionId } = await escenario(40000);
    const precio = fixture.productPriceCents;
    const propina = 8000;

    await venta(
      fixture,
      token,
      sessionId,
      [{ method: 'CARD', amount_cents: precio + propina, approval_code: '998877' }],
      propina
    );

    const liquidacion = await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${sessionId}/tips/settle`,
      headers: bearerHeaders(token),
      payload: { pay_cash_now: true }
    });

    expect(liquidacion.statusCode).toBe(201);
    /**
     * No hay movimiento de caja porque esa propina nunca estuvo en el cajón: la cobró el
     * comercio con la tarjeta y se la debe al mesero. Sacarla de allí dejaría el turno
     * corto por un dinero que jamás entró.
     */
    expect(liquidacion.json().cash_movement_id).toBeNull();
    expect(liquidacion.json().summary.cash_cents).toBe(0);
    expect(liquidacion.json().summary.electronic_cents).toBe(propina);
  }, 90_000);

  it('reparte por partes iguales en bolsa común y no liquida dos veces', async () => {
    const { fixture, token, sessionId } = await escenario(30000);
    const precio = fixture.productPriceCents;

    await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/tips',
      headers: bearerHeaders(token),
      payload: { policy: 'POOL', auto_settle_on_close: false }
    });

    const uno = await nuevoMesero(fixture, 'Ana');
    const dos = await nuevoMesero(fixture, 'Beto');

    await venta(fixture, token, sessionId, [{ method: 'CASH', amount_cents: precio + 9000 }], 9000, uno);
    await venta(fixture, token, sessionId, [{ method: 'CASH', amount_cents: precio + 1000 }], 1000, dos);

    const resumen = await app.inject({
      method: 'GET',
      url: `/api/v1/cash-sessions/${sessionId}/tips`,
      headers: bearerHeaders(token)
    });

    const cuerpo = resumen.json();
    expect(cuerpo.policy).toBe('POOL');
    expect(cuerpo.total_cents).toBe(10000);
    // Ana juntó 9.000 y Beto 1.000, pero en bolsa común cada uno se lleva 5.000.
    expect(cuerpo.shares.map((share: { earned_cents: number }) => share.earned_cents)).toEqual([5000, 5000]);

    const primera = await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${sessionId}/tips/settle`,
      headers: bearerHeaders(token),
      payload: { pay_cash_now: true }
    });
    expect(primera.statusCode).toBe(201);

    // Liquidar dos veces sería pagar dos veces la misma propina.
    const segunda = await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${sessionId}/tips/settle`,
      headers: bearerHeaders(token),
      payload: { pay_cash_now: true }
    });
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().error.code).toBe('TIPS_ALREADY_SETTLED');
  }, 90_000);
});

describe('Reparto de propina (unidad)', () => {
  it('no pierde centavos al repartir entre medios', () => {
    // 7 no divide exacto entre 3: el sobrante tiene que colocarse, no perderse.
    expect(allocateTip([100, 100, 100], 7).reduce((a, b) => a + b, 0)).toBe(7);
    expect(allocateTip([1000, 500], 30)).toEqual([20, 10]);
    expect(allocateTip([1000, 1], 30).reduce((a, b) => a + b, 0)).toBe(30);
  });

  it('nunca asigna a un pago más propina que su propio importe', () => {
    // Un pago de 5 no puede cargar con 30 de propina aunque le tocara por proporción.
    const partes = allocateTip([5, 1000], 30);
    expect(partes[0]).toBeLessThanOrEqual(5);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(30);
  });

  it('la bolsa común reparte el sobrante en vez de perderlo', () => {
    expect(splitPool(10, 3)).toEqual([4, 3, 3]);
    expect(splitPool(10, 3).reduce((a, b) => a + b, 0)).toBe(10);
  });
});
