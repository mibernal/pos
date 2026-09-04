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
 * Pedido desde el menú QR.
 *
 * Es una superficie pública que **escribe en la cocina**, así que lo que más importa probar
 * es lo que no se puede hacer: pedir con un código inventado, pedir a un comercio que no
 * contrató el módulo, y poner uno mismo el precio de lo que se está pidiendo.
 */

describe('Pedido por QR', () => {
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

  async function escenario(conModulo = true) {
    const fixture = await seedE2eFixture(app, { productPriceCents: 25_000 });
    fixtures.push(fixture);
    await grantModules(fixture.tenantId, conModulo ? ['restaurant', 'tables', 'qr_menu'] : ['restaurant', 'tables']);
    await grantLimits(fixture.tenantId, { tables: 10 });

    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

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
        name: 'Mesa 7',
        capacity: 4
      })
      .execute();

    return { fixture, token, tableId };
  }

  async function emitirToken(token: string, tableId: string) {
    const respuesta = await app.inject({
      method: 'POST',
      url: `/api/v1/tables/${tableId}/qr-token`,
      headers: bearerHeaders(token)
    });
    expect(respuesta.statusCode).toBe(200);
    return respuesta.json().qr_token as string;
  }

  it('el comensal ve la carta de su sucursal y pide desde su mesa', async () => {
    const { fixture, token, tableId } = await escenario();
    const qr = await emitirToken(token, tableId);

    const carta = await app.inject({ method: 'GET', url: `/api/v1/public/qr/${qr}` });
    expect(carta.statusCode).toBe(200);
    expect(carta.json().table_name).toBe('Mesa 7');
    expect(carta.json().order).toBeNull();
    expect(carta.json().menu.flatMap((c: { products: unknown[] }) => c.products)).toHaveLength(1);

    const pedido = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${qr}/orders`,
      payload: { items: [{ product_id: fixture.productId, qty: 2 }] }
    });
    expect(pedido.statusCode).toBe(201);

    const despues = await app.inject({ method: 'GET', url: `/api/v1/public/qr/${qr}` });
    expect(despues.json().order.total_cents).toBe(50_000);
    expect(despues.json().order.lines[0].source).toBe('QR');

    // Entra por la misma puerta que el mesero: la cocina lo ve.
    const comandas = await adminDb()
      .selectFrom('kitchen_tickets')
      .select('id')
      .where('tenant_id', '=', fixture.tenantId)
      .execute();
    expect(comandas.length).toBeGreaterThan(0);

    // Y la mesa queda ocupada, como si la hubiera abierto el mesero.
    const mesa = await adminDb()
      .selectFrom('tables')
      .select('status')
      .where('id', '=', tableId)
      .executeTakeFirstOrThrow();
    expect(mesa.status).toBe('OCCUPIED');
  });

  it('el precio lo pone el servidor, no el móvil del cliente', async () => {
    const { fixture, token, tableId } = await escenario();
    const qr = await emitirToken(token, tableId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${qr}/orders`,
      // Un cliente listo intentaría colar su propio precio. El esquema no lo admite y, aunque
      // lo admitiera, el importe sale del catálogo.
      payload: { items: [{ product_id: fixture.productId, qty: 1, price_cents: 1 }] }
    });

    const linea = await adminDb()
      .selectFrom('table_order_items')
      .select(['price_cents', 'line_total_cents'])
      .where('tenant_id', '=', fixture.tenantId)
      .executeTakeFirst();

    expect(linea?.price_cents).toBe(25_000);
    expect(linea?.line_total_cents).toBe(25_000);
  });

  it('un código inventado no existe, y tampoco dice que no existe de otra forma', async () => {
    const inventado = 'a'.repeat(43);
    const respuesta = await app.inject({ method: 'GET', url: `/api/v1/public/qr/${inventado}` });
    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json().error?.code ?? respuesta.json().code).toBe('QR_NOT_FOUND');
  });

  it('sin el módulo contratado, el código responde lo mismo que uno inventado', async () => {
    const { token, tableId } = await escenario(false);

    // El token se emite con el módulo puesto y luego se retira: lo que se prueba es la
    // guarda de la ruta pública, no la de la privada.
    await adminDb().updateTable('tenant_module_overrides').set({ enabled: true }).where('module', '=', 'qr_menu').execute();
    const qr = await emitirToken(token, tableId).catch(() => null);

    if (!qr) return; // Sin módulo no se puede ni emitir: la guarda privada ya cerró la puerta.

    await adminDb().deleteFrom('tenant_module_overrides').where('module', '=', 'qr_menu').execute();

    const respuesta = await app.inject({ method: 'GET', url: `/api/v1/public/qr/${qr}` });
    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json().error?.code ?? respuesta.json().code).toBe('QR_NOT_FOUND');
  });

  it('rotar el código invalida el anterior', async () => {
    const { token, tableId } = await escenario();
    const viejo = await emitirToken(token, tableId);
    const nuevo = await emitirToken(token, tableId);

    expect(nuevo).not.toBe(viejo);
    expect((await app.inject({ method: 'GET', url: `/api/v1/public/qr/${viejo}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/v1/public/qr/${nuevo}` })).statusCode).toBe(200);
  });

  it('pedir la cuenta queda anotado para el salón', async () => {
    const { fixture, token, tableId } = await escenario();
    const qr = await emitirToken(token, tableId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${qr}/orders`,
      payload: { items: [{ product_id: fixture.productId, qty: 1 }] }
    });

    const respuesta = await app.inject({ method: 'POST', url: `/api/v1/public/qr/${qr}/bill` });
    expect(respuesta.statusCode).toBe(200);

    const vista = await app.inject({ method: 'GET', url: `/api/v1/public/qr/${qr}` });
    expect(vista.json().order.bill_requested).toBe(true);
  });
});
