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
 * Informes de operación del restaurante.
 *
 * Cuatro preguntas de encargado que hasta ahora no tenían respuesta: cuánto tarda una mesa en
 * girar, cuánto tarda la cocina, a qué horas se vende y qué platos merecen estar en la carta.
 */

describe('Informes de operación', () => {
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

  async function escenario() {
    const fixture = await seedE2eFixture(app, { productPriceCents: 30_000 });
    fixtures.push(fixture);
    await grantModules(fixture.tenantId, ['restaurant', 'tables', 'kitchen', 'kds']);
    await grantLimits(fixture.tenantId, { tables: 10 });

    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    const turnoCaja = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(token),
      payload: { branch_id: fixture.branchId, terminal_id: fixture.terminalId, opening_amount_cents: 0 }
    });
    expect(turnoCaja.statusCode).toBe(201);

    const roomId = randomUUID();
    const tableId = randomUUID();

    await adminDb()
      .insertInto('rooms')
      .values({ id: roomId, tenant_id: fixture.tenantId, branch_id: fixture.branchId, name: 'Salón' })
      .execute();

    await adminDb()
      .insertInto('tables')
      .values({
        id: tableId,
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        room_id: roomId,
        name: 'Mesa 4',
        capacity: 4
      })
      .execute();

    return {
      fixture,
      token,
      roomId,
      tableId,
      sessionId: turnoCaja.json().cash_session.id as string,
      hoy: fechaLocal()
    };
  }

  function fechaLocal(): string {
    const ahora = new Date();
    return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
  }

  function informe(token: string, nombre: string, fixture: E2eFixture, hoy: string) {
    return app.inject({
      method: 'GET',
      url: `/api/v1/reports/operations/${nombre}?branch_id=${fixture.branchId}&from=${hoy}&to=${hoy}`,
      headers: bearerHeaders(token)
    });
  }

  it('mide la rotación de la mesa desde que se abre la cuenta hasta que se cobra', async () => {
    const { fixture, token, tableId, sessionId, hoy } = await escenario();

    // La cuenta se abrió hace 45 minutos: la mesa estuvo ocupada ese tiempo.
    const orderId = randomUUID();
    await adminDb()
      .insertInto('table_orders')
      .values({
        id: orderId,
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        table_id: tableId,
        status: 'COMPLETED',
        guests_count: 3,
        created_at: new Date(Date.now() - 45 * 60 * 1000)
      })
      .execute();

    const venta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(token),
      payload: {
        client_uuid: randomUUID(),
        branch_id: fixture.branchId,
        cash_session_id: sessionId,
        table_order_id: orderId,
        items: [{ product_id: fixture.productId, qty: 2 }],
        discount_cents: 0,
        payments: [{ method: 'CASH', amount_cents: 60_000 }]
      }
    });
    expect(venta.statusCode).toBe(201);

    const respuesta = await informe(token, 'table-turnover', fixture, hoy);
    expect(respuesta.statusCode).toBe(200);

    const mesa = respuesta.json().find((fila: { table_id: string }) => fila.table_id === tableId);
    expect(mesa.services).toBe(1);
    expect(mesa.guests).toBe(3);
    expect(mesa.avg_ticket_cents).toBe(60_000);
    // No se compara exacto: entre el insert y la venta pasan milisegundos reales.
    expect(mesa.avg_minutes).toBeGreaterThan(44);
    expect(mesa.avg_minutes).toBeLessThan(47);
  });

  it('mide el tiempo de cocina contra la marca de listo, no contra la última edición', async () => {
    const { fixture, token, tableId, hoy } = await escenario();

    const orderId = randomUUID();
    await adminDb()
      .insertInto('table_orders')
      .values({
        id: orderId,
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        table_id: tableId,
        status: 'OPEN'
      })
      .execute();

    const roundId = randomUUID();
    await adminDb()
      .insertInto('order_rounds')
      .values({
        id: roundId,
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        table_order_id: orderId,
        round_number: 1
      })
      .execute();

    // Dos comandas: una de 10 minutos y otra de 20.
    for (const minutos of [10, 20]) {
      const ticketId = randomUUID();
      const creado = new Date(Date.now() - (minutos + 5) * 60 * 1000);
      await adminDb()
        .insertInto('kitchen_tickets')
        .values({
          id: ticketId,
          tenant_id: fixture.tenantId,
          branch_id: fixture.branchId,
          round_id: roundId,
          table_order_id: orderId,
          status: 'DELIVERED',
          created_at: creado,
          ready_at: new Date(creado.getTime() + minutos * 60 * 1000),
          // `updated_at` se pisó al entregar: si el informe lo mirara, mediría otra cosa.
          updated_at: new Date()
        })
        .execute();

      await adminDb()
        .insertInto('kitchen_ticket_items')
        .values({
          id: randomUUID(),
          tenant_id: fixture.tenantId,
          branch_id: fixture.branchId,
          kitchen_ticket_id: ticketId,
          table_order_id: orderId,
          product_id: fixture.productId,
          qty: 1
        })
        .execute();
    }

    const respuesta = await informe(token, 'prep-time', fixture, hoy);
    expect(respuesta.statusCode).toBe(200);

    const cocina = respuesta.json().find((fila: { station: string }) => fila.station === 'KITCHEN');
    expect(cocina.tickets).toBe(2);
    expect(cocina.avg_minutes).toBeCloseTo(15, 0);
    // El p90 se acerca al peor de los dos, que es lo que enfada al cliente.
    expect(cocina.p90_minutes).toBeGreaterThan(18);
  });

  it('reparte las ventas por franja horaria', async () => {
    const { fixture, token, sessionId, hoy } = await escenario();

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
        payments: [{ method: 'CASH', amount_cents: 30_000 }]
      }
    });
    expect(venta.statusCode).toBe(201);

    const respuesta = await informe(token, 'sales-by-hour', fixture, hoy);
    expect(respuesta.statusCode).toBe(200);

    const franja = respuesta.json().find((fila: { hour: number }) => fila.hour === new Date().getHours());
    expect(franja.sales_count).toBe(1);
    expect(franja.avg_ticket_cents).toBe(30_000);
  });

  it('clasifica la carta cruzando lo que se vende con lo que deja', async () => {
    const { fixture, token, sessionId, hoy } = await escenario();

    const insumo = randomUUID();
    await adminDb()
      .insertInto('products')
      .values({
        id: insumo,
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        name: 'Insumo',
        category: 'Insumos',
        tax_category: 'IVA_19',
        price_cents: 0,
        cost_cents: 9_000,
        active: true
      })
      .execute();

    await app.inject({
      method: 'PUT',
      url: `/api/v1/recipes/${fixture.productId}`,
      headers: bearerHeaders(token),
      payload: { yield_qty: 1, components: [{ ingredient_product_id: insumo, qty: 1 }] }
    });

    const venta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(token),
      payload: {
        client_uuid: randomUUID(),
        branch_id: fixture.branchId,
        cash_session_id: sessionId,
        items: [{ product_id: fixture.productId, qty: 4 }],
        discount_cents: 0,
        payments: [{ method: 'CASH', amount_cents: 120_000 }]
      }
    });
    expect(venta.statusCode).toBe(201);

    const respuesta = await informe(token, 'menu-engineering', fixture, hoy);
    expect(respuesta.statusCode).toBe(200);

    const plato = respuesta.json().find((fila: { product_id: string }) => fila.product_id === fixture.productId);
    expect(plato.qty_sold).toBe(4);
    expect(plato.theoretical_cost_cents).toBe(9_000);
    // (30.000 − 9.000) / 30.000
    expect(plato.margin_percent).toBe(70);
    // Único plato de la carta: se porta como la media, así que queda por encima en las dos.
    expect(plato.classification).toBe('ESTRELLA');
  });
});
