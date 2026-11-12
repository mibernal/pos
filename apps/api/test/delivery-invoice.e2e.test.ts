import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
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
 * Facturación de domicilios.
 *
 * Un domicilio recorría su ciclo completo hasta ENTREGADO y ahí se acababa: nada creaba la
 * venta, así que el pedido se cobraba y no se facturaba. Estas pruebas cubren el camino
 * nuevo y —sobre todo— lo que no debe pasar: facturar dos veces el mismo pedido, o
 * facturar uno que todavía va en camino.
 */

let app: FastifyInstance;
const fixtures: E2eFixture[] = [];

async function enableDelivery(tenantId: string) {
  // Desde la fase 7 los módulos salen del plan; la columna de `tenants` es una vista de
  // compatibilidad y ya no habilita nada por sí sola.
  await grantModules(tenantId, ['delivery', 'restaurant']);
}

async function openCashSession(fixture: E2eFixture): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO cash_sessions (id, tenant_id, branch_id, terminal_id, opened_by_user_id,
                               opening_amount_cents, status)
    VALUES (${id}, ${fixture.tenantId}, ${fixture.branchId}, ${fixture.terminalId},
            ${fixture.adminUserId}, 0, 'OPEN')
  `.execute(adminDb());
  return id;
}

async function seedDelivery(
  fixture: E2eFixture,
  options: { status: string; qty?: number } = { status: 'DELIVERED' }
): Promise<string> {
  const deliveryId = randomUUID();

  await sql`
    INSERT INTO deliveries (id, tenant_id, branch_id, status, customer_name, customer_phone,
                            delivery_address, total_cents)
    VALUES (${deliveryId}, ${fixture.tenantId}, ${fixture.branchId}, ${options.status},
            'Cliente Domicilio', '3001234567', 'Calle 45 # 12-30', ${fixture.productPriceCents})
  `.execute(adminDb());

  await sql`
    INSERT INTO delivery_items (id, tenant_id, branch_id, delivery_id, product_id, qty,
                                price_cents, line_total_cents)
    VALUES (${randomUUID()}, ${fixture.tenantId}, ${fixture.branchId}, ${deliveryId},
            ${fixture.productId}, ${options.qty ?? 1}, ${fixture.productPriceCents},
            ${fixture.productPriceCents})
  `.execute(adminDb());

  return deliveryId;
}

async function readDeliverySaleId(deliveryId: string): Promise<string | null> {
  const { rows } = await sql<{ sale_id: string | null }>`
    SELECT sale_id FROM deliveries WHERE id = ${deliveryId}
  `.execute(adminDb());
  return rows[0]?.sale_id ?? null;
}

describe('Facturación de domicilios', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    for (const fixture of fixtures) {
      await sql`DELETE FROM delivery_items WHERE tenant_id = ${fixture.tenantId}`.execute(adminDb());
      await sql`DELETE FROM deliveries WHERE tenant_id = ${fixture.tenantId}`.execute(adminDb());
      await cleanupE2eFixture(app, fixture);
    }
    await app.close();
  });

  async function setup() {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await enableDelivery(fixture.tenantId);
    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });
    const cashSessionId = await openCashSession(fixture);
    return { fixture, token, cashSessionId };
  }

  it('un domicilio entregado genera su venta y queda vinculado a ella', async () => {
    const { fixture, token, cashSessionId } = await setup();
    const deliveryId = await seedDelivery(fixture);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/branches/${fixture.branchId}/deliveries/${deliveryId}/invoice`,
      headers: bearerHeaders(token),
      payload: {
        cash_session_id: cashSessionId,
        payments: [{ method: 'CASH', amount_cents: fixture.productPriceCents }]
      }
    });

    expect(response.statusCode, response.body).toBe(201);
    const body = response.json() as { sale_id: string; already_invoiced: boolean };

    expect(body.already_invoiced).toBe(false);
    expect(await readDeliverySaleId(deliveryId)).toBe(body.sale_id);
  });

  it('facturar dos veces el mismo domicilio no crea una segunda venta', async () => {
    // Un domicilio con dos facturas es un problema fiscal que solo se arregla con nota
    // crédito. El doble clic del repartidor no puede costar eso.
    const { fixture, token, cashSessionId } = await setup();
    const deliveryId = await seedDelivery(fixture);

    const payload = {
      cash_session_id: cashSessionId,
      payments: [{ method: 'CASH', amount_cents: fixture.productPriceCents }]
    };

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/branches/${fixture.branchId}/deliveries/${deliveryId}/invoice`,
      headers: bearerHeaders(token),
      payload
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/branches/${fixture.branchId}/deliveries/${deliveryId}/invoice`,
      headers: bearerHeaders(token),
      payload
    });

    expect(first.statusCode, first.body).toBe(201);
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().sale_id).toBe(first.json().sale_id);
    expect(second.json().already_invoiced).toBe(true);

    const { rows } = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM sales WHERE tenant_id = ${fixture.tenantId}
    `.execute(adminDb());
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it('genera el evento de emisión DIAN en la bandeja de salida', async () => {
    // Es el punto de todo esto: que el domicilio acabe produciendo un documento fiscal.
    const { fixture, token, cashSessionId } = await setup();
    const deliveryId = await seedDelivery(fixture);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/branches/${fixture.branchId}/deliveries/${deliveryId}/invoice`,
      headers: bearerHeaders(token),
      payload: {
        cash_session_id: cashSessionId,
        payments: [{ method: 'CASH', amount_cents: fixture.productPriceCents }]
      }
    });

    const saleId = response.json().sale_id as string;

    const { rows } = await sql<{ type: string }>`
      SELECT type FROM outbox_events
      WHERE tenant_id = ${fixture.tenantId} AND aggregate_id = ${saleId}
    `.execute(adminDb());

    expect(rows.map((r) => r.type)).toContain('sale.created');
  });

  it('no factura un domicilio que todavía va en camino', async () => {
    const { fixture, token, cashSessionId } = await setup();
    const deliveryId = await seedDelivery(fixture, { status: 'ON_THE_WAY' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/branches/${fixture.branchId}/deliveries/${deliveryId}/invoice`,
      headers: bearerHeaders(token),
      payload: {
        cash_session_id: cashSessionId,
        payments: [{ method: 'CASH', amount_cents: fixture.productPriceCents }]
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('DELIVERY_NOT_DELIVERED');
    expect(await readDeliverySaleId(deliveryId)).toBeNull();
  });

  it('no factura un domicilio cancelado', async () => {
    const { fixture, token, cashSessionId } = await setup();
    const deliveryId = await seedDelivery(fixture, { status: 'CANCELLED' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/branches/${fixture.branchId}/deliveries/${deliveryId}/invoice`,
      headers: bearerHeaders(token),
      payload: {
        cash_session_id: cashSessionId,
        payments: [{ method: 'CASH', amount_cents: fixture.productPriceCents }]
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('DELIVERY_CANCELLED');
  });

  it('un comercio no puede facturar el domicilio de otro', async () => {
    const victim = await setup();
    const attacker = await setup();
    const deliveryId = await seedDelivery(victim.fixture);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/branches/${attacker.fixture.branchId}/deliveries/${deliveryId}/invoice`,
      headers: bearerHeaders(attacker.token),
      payload: {
        cash_session_id: attacker.cashSessionId,
        payments: [{ method: 'CASH', amount_cents: victim.fixture.productPriceCents }]
      }
    });

    expect(response.statusCode).toBe(404);
    expect(await readDeliverySaleId(deliveryId)).toBeNull();
  });
});
