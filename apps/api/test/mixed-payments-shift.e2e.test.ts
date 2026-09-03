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
 * Un turno con medios mezclados, que es el criterio de salida de la fase 9.
 *
 * Antes de la migración 099 esta prueba no se podía escribir: los pagos vivían dentro de un
 * `payment_json` sin forma, el efectivo esperado se adivinaba recorriendo quince rutas de
 * ese JSON, y el desglose del Z era un objeto literal de tres claves que descartaba en
 * silencio cualquier medio que no fuera efectivo, tarjeta o transferencia. Un turno con
 * Nequi y un fiado cuadraba de menos y nadie sabía por qué.
 */

describe('Turno con medios de pago mezclados', () => {
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

  async function nuevoComercio(precioCents: number) {
    const fixture = await seedE2eFixture(app, { productPriceCents: precioCents });
    fixtures.push(fixture);

    // Los medios que un comercio no usa nacen apagados; este turno usa billetera y fiado.
    await adminDb()
      .updateTable('payment_method_catalog')
      .set({ active: true })
      .where('tenant_id', '=', fixture.tenantId)
      .where('code', 'in', ['NEQUI', 'STORE_CREDIT'])
      .execute();

    return fixture;
  }

  async function abrirTurno(fixture: E2eFixture, token: string, aperturaCents: number) {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(token),
      payload: {
        branch_id: fixture.branchId,
        terminal_id: fixture.terminalId,
        opening_amount_cents: aperturaCents
      }
    });

    expect(respuesta.statusCode).toBe(201);
    return respuesta.json().cash_session.id as string;
  }

  async function venta(
    fixture: E2eFixture,
    token: string,
    sessionId: string,
    payments: unknown[],
    extra: Record<string, unknown> = {}
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
        tip_cents: 0,
        payments,
        ...extra
      }
    });
  }

  it('cierra con diferencia cero mezclando efectivo con vuelto, billetera y fiado', async () => {
    const fixture = await nuevoComercio(30000);
    const token = await loginE2eUser(app, { email: fixture.adminEmail, password: fixture.adminPassword });
    const sessionId = await abrirTurno(fixture, token, 50000);

    const primera = await venta(fixture, token, sessionId, [
      { method: 'CASH', amount_cents: fixture.productPriceCents, tendered_cents: 50000 }
    ]);
    expect(primera.statusCode).toBe(201);
    const precio = fixture.productPriceCents;

    const porNequi = await venta(fixture, token, sessionId, [
      { method: 'WALLET', method_code: 'NEQUI', amount_cents: precio, reference: 'M12345678' }
    ]);
    expect(porNequi.statusCode).toBe(201);

    const cliente = randomUUID();
    await adminDb()
      .insertInto('customers')
      .values({
        id: cliente,
        tenant_id: fixture.tenantId,
        document_type: 'CC',
        document_number: `9${Date.now().toString().slice(-8)}`,
        name: 'Cliente del barrio'
      })
      .execute();

    const fiado = await venta(
      fixture,
      token,
      sessionId,
      [{ method: 'STORE_CREDIT', amount_cents: precio }],
      { customer_id: cliente }
    );
    expect(fiado.statusCode).toBe(201);

    const cierre = await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${sessionId}/close`,
      headers: bearerHeaders(token),
      payload: { closing_cash_real_cents: 50000 + precio }
    });

    expect(cierre.statusCode).toBe(200);
    const resumen = cierre.json().summary;

    /**
     * En el cajón hay la apertura más el importe de la venta en efectivo. Ni los 50.000 que
     * entregó el cliente —el vuelto salió del mismo cajón— ni el Nequi ni el fiado, que no
     * pusieron un peso ahí.
     */
    expect(resumen.expected_cash_cents).toBe(50000 + precio);
    expect(resumen.diff_cents).toBe(0);

    expect(resumen.completed_sales_count).toBe(3);
    expect(resumen.completed_sales_total_cents).toBe(precio * 3);

    const desglose = resumen.payment_breakdown;
    expect(desglose.cash_cents).toBe(precio);
    expect(desglose.electronic_cents).toBe(precio);
    // Lo vendido a crédito se ve aparte: es venta, no es dinero de hoy.
    expect(desglose.deferred_cents).toBe(precio);
    expect(desglose.total_cents).toBe(precio * 3);

    expect(desglose.tendered_cents).toBe(50000);
    expect(desglose.change_cents).toBe(50000 - precio);

    const codigos = desglose.rows.map((fila: { code: string }) => fila.code).sort();
    expect(codigos).toEqual(['CASH', 'NEQUI', 'STORE_CREDIT']);

    const nequi = desglose.rows.find((fila: { code: string }) => fila.code === 'NEQUI');
    expect(nequi.label).toBe('Nequi');
    expect(nequi.group).toBe('ELECTRONIC');
  }, 90_000);

  it('el desglose del turno cerrado se congela y no cambia si luego se anula una venta', async () => {
    const fixture = await nuevoComercio(20000);
    const token = await loginE2eUser(app, { email: fixture.adminEmail, password: fixture.adminPassword });
    const sessionId = await abrirTurno(fixture, token, 0);
    const precio = fixture.productPriceCents;

    const creada = await venta(fixture, token, sessionId, [{ method: 'CASH', amount_cents: precio }]);
    expect(creada.statusCode).toBe(201);
    const saleId = creada.json().sale.id as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${sessionId}/close`,
      headers: bearerHeaders(token),
      payload: { closing_cash_real_cents: precio }
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/void`,
      headers: bearerHeaders(token),
      payload: { void_reason: 'Prueba de congelado del Z' }
    });

    const resumen = await app.inject({
      method: 'GET',
      url: `/api/v1/cash-sessions/${sessionId}/z-report`,
      headers: bearerHeaders(token)
    });

    expect(resumen.statusCode).toBe(200);

    /**
     * El Z reimpreso dice lo que dijo al cerrar. Recalcularlo convertiría un documento de
     * cierre en una consulta cuyo resultado cambia solo, y el cajero no podría defender la
     * cifra con la que cuadró su turno.
     */
    expect(resumen.json().summary.payment_breakdown.cash_cents).toBe(precio);
  }, 90_000);

  it('rechaza un medio apagado, uno inexistente, un tipo falseado y un fiado sin cliente', async () => {
    const fixture = await nuevoComercio(10000);
    const token = await loginE2eUser(app, { email: fixture.adminEmail, password: fixture.adminPassword });
    const sessionId = await abrirTurno(fixture, token, 0);
    const precio = fixture.productPriceCents;

    // `DAVIPLATA` existe en el catálogo pero nace apagado.
    const apagado = await venta(fixture, token, sessionId, [
      { method: 'WALLET', method_code: 'DAVIPLATA', amount_cents: precio }
    ]);
    expect(apagado.statusCode).toBe(400);
    expect(apagado.json().error.code).toBe('PAYMENT_METHOD_INACTIVE');

    const inexistente = await venta(fixture, token, sessionId, [
      { method: 'WALLET', method_code: 'INVENTADO', amount_cents: precio }
    ]);
    expect(inexistente.statusCode).toBe(400);
    expect(inexistente.json().error.code).toBe('PAYMENT_METHOD_UNKNOWN');

    /**
     * Declarar efectivo sobre el código de una billetera metería en el arqueo dinero que
     * nunca entró al cajón. El tipo lo manda el catálogo, no quien envía la venta.
     */
    const tipoFalseado = await venta(fixture, token, sessionId, [
      { method: 'CASH', method_code: 'NEQUI', amount_cents: precio }
    ]);
    expect(tipoFalseado.statusCode).toBe(400);
    expect(tipoFalseado.json().error.code).toBe('PAYMENT_METHOD_KIND_MISMATCH');

    const sinCliente = await venta(fixture, token, sessionId, [
      { method: 'STORE_CREDIT', amount_cents: precio }
    ]);
    expect(sinCliente.statusCode).toBe(400);
    expect(sinCliente.json().error.code).toBe('CUSTOMER_REQUIRED_FOR_CREDIT');
  }, 90_000);

  it('una venta antigua sin method_code sigue siendo válida', async () => {
    // Es lo que llega de la cola offline de una PWA que aún no se actualizó.
    const fixture = await nuevoComercio(15000);
    const token = await loginE2eUser(app, { email: fixture.adminEmail, password: fixture.adminPassword });
    const sessionId = await abrirTurno(fixture, token, 0);

    const respuesta = await venta(fixture, token, sessionId, [
      { method: 'CASH', amount_cents: fixture.productPriceCents }
    ]);
    expect(respuesta.statusCode).toBe(201);

    const pagos = await adminDb()
      .selectFrom('sale_payments')
      .select(['method_code', 'kind', 'amount_cents', 'tendered_cents'])
      .where('tenant_id', '=', fixture.tenantId)
      .execute();

    expect(pagos).toHaveLength(1);
    expect(pagos[0]!.method_code).toBe('CASH');
    expect(pagos[0]!.tendered_cents).toBeNull();
  }, 90_000);
});
