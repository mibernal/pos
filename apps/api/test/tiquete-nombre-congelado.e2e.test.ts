import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
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
 * Lo vendido se describió de una manera concreta el día que se vendió.
 *
 * Hasta la fase 13, `sale_items` guardaba el `product_id` y el precio, pero no el nombre:
 * el nombre se resolvía con un join contra `products` **cada vez que alguien miraba la
 * venta**. Renombrar «Café» a «Café Americano» reescribía, hacia atrás, el nombre impreso en
 * todos los tiquetes ya emitidos. Para un documento con obligación fiscal eso no debería
 * poder pasar.
 *
 * Esta prueba cobra una venta, renombra el producto y vuelve a pedir la venta. Si el nombre
 * cambió, el arreglo no está.
 */
describe('El tiquete no cambia cuando cambia el catálogo', () => {
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

  async function abrirTurno(fixture: E2eFixture, token: string) {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(token),
      payload: {
        branch_id: fixture.branchId,
        terminal_id: fixture.terminalId,
        opening_amount_cents: 50_000
      }
    });
    expect(respuesta.statusCode, respuesta.body).toBe(201);
    return respuesta.json().cash_session.id as string;
  }

  it('renombrar un producto no toca una venta ya cobrada', async () => {
    const fixture = await seedE2eFixture(app, { productPriceCents: 30_000 });
    fixtures.push(fixture);
    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });
    const sessionId = await abrirTurno(fixture, token);

    const nombreOriginal = await adminDb()
      .selectFrom('products')
      .select('name')
      .where('id', '=', fixture.productId)
      .executeTakeFirstOrThrow();

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
        tip_cents: 0,
        payments: [{ method: 'CASH', amount_cents: fixture.productPriceCents }]
      }
    });

    expect(venta.statusCode, venta.body).toBe(201);
    const saleId = venta.json().sale.id as string;

    // El catálogo cambia. La venta no debería enterarse.
    await adminDb()
      .updateTable('products')
      .set({ name: 'Nombre Cambiado Después De Vender' })
      .where('id', '=', fixture.productId)
      .execute();

    const consulta = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/${saleId}`,
      headers: bearerHeaders(token)
    });

    expect(consulta.statusCode, consulta.body).toBe(200);
    const linea = consulta.json().items[0];

    expect(linea.product_name).toBe(nombreOriginal.name);
    expect(linea.product_name).not.toBe('Nombre Cambiado Después De Vender');
  }, 60_000);

  it('una venta anterior a la migración usa el catálogo, y nunca imprime «null»', async () => {
    const fixture = await seedE2eFixture(app, { productPriceCents: 12_000 });
    fixtures.push(fixture);
    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });
    const sessionId = await abrirTurno(fixture, token);

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
        tip_cents: 0,
        payments: [{ method: 'CASH', amount_cents: fixture.productPriceCents }]
      }
    });
    expect(venta.statusCode, venta.body).toBe(201);
    const saleId = venta.json().sale.id as string;

    // Se simula una venta vieja: se vacía el nombre congelado, que es exactamente el estado
    // en que la migración 111 deja las ventas anteriores a ella.
    await adminDb()
      .updateTable('sale_items')
      .set({ product_name: null })
      .where('sale_id', '=', saleId)
      .execute();

    const consulta = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/${saleId}`,
      headers: bearerHeaders(token)
    });

    const linea = consulta.json().items[0];
    // Cae al catálogo, que para una venta vieja es lo mejor que hay — pero nunca a «null».
    expect(linea.product_name).toBeTruthy();
    expect(linea.product_name).not.toBe('null');
  }, 60_000);
});
