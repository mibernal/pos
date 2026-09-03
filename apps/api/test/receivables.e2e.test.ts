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
 * El fiado, de punta a punta.
 *
 * En una tienda de barrio colombiana esto no es una función avanzada: es la forma normal de
 * vender a la clientela conocida. Lo que se fija aquí es que la deuda tenga titular, cupo y
 * vencimiento, que el abono baje el saldo, y —lo que más descuadra cajas— que un abono en
 * efectivo entre al arqueo del turno en el que se recibió.
 */

describe('Cuentas por cobrar', () => {
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

  async function escenario(precioCents: number, cupoCents: number | null) {
    const fixture = await seedE2eFixture(app, { productPriceCents: precioCents });
    fixtures.push(fixture);

    await adminDb()
      .updateTable('payment_method_catalog')
      .set({ active: true })
      .where('tenant_id', '=', fixture.tenantId)
      .where('code', '=', 'STORE_CREDIT')
      .execute();

    const customerId = randomUUID();
    await adminDb()
      .insertInto('customers')
      .values({
        id: customerId,
        tenant_id: fixture.tenantId,
        document_type: 'CC',
        document_number: `8${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`,
        name: 'Doña Rosa'
      })
      .execute();

    const token = await loginE2eUser(app, { email: fixture.adminEmail, password: fixture.adminPassword });

    if (cupoCents !== undefined) {
      const cupo = await app.inject({
        method: 'PUT',
        url: `/api/v1/customers/${customerId}/credit`,
        headers: bearerHeaders(token),
        payload: { credit_limit_cents: cupoCents, terms_days: 15, status: 'ACTIVE' }
      });
      expect(cupo.statusCode).toBe(200);
    }

    const turno = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(token),
      payload: { branch_id: fixture.branchId, terminal_id: fixture.terminalId, opening_amount_cents: 0 }
    });
    expect(turno.statusCode).toBe(201);

    return { fixture, token, customerId, sessionId: turno.json().cash_session.id as string };
  }

  function ventaFiada(fixture: E2eFixture, token: string, sessionId: string, customerId: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(token),
      payload: {
        client_uuid: randomUUID(),
        branch_id: fixture.branchId,
        cash_session_id: sessionId,
        customer_id: customerId,
        items: [{ product_id: fixture.productId, qty: 1 }],
        discount_cents: 0,
        tip_cents: 0,
        payments: [{ method: 'STORE_CREDIT', amount_cents: fixture.productPriceCents }]
      }
    });
  }

  it('fía, deja el saldo con vencimiento y lo baja con un abono', async () => {
    const { fixture, token, customerId, sessionId } = await escenario(30000, 100000);
    const precio = fixture.productPriceCents;

    const venta = await ventaFiada(fixture, token, sessionId, customerId);
    expect(venta.statusCode).toBe(201);

    const estado = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${customerId}/statement`,
      headers: bearerHeaders(token)
    });

    expect(estado.statusCode).toBe(200);
    const cuenta = estado.json();

    expect(cuenta.account.balance_cents).toBe(precio);
    expect(cuenta.account.available_cents).toBe(100000 - precio);
    expect(cuenta.receivables).toHaveLength(1);
    expect(cuenta.receivables[0].status).toBe('OPEN');
    expect(cuenta.receivables[0].due_at).not.toBeNull();
    // El documento apunta a la venta que lo originó: es lo que permite reclamarlo.
    expect(cuenta.receivables[0].sale_number).toBeGreaterThan(0);

    const abono = await app.inject({
      method: 'POST',
      url: `/api/v1/customers/${customerId}/payments`,
      headers: bearerHeaders(token),
      payload: {
        amount_cents: 10000,
        method: 'CASH',
        method_code: 'CASH',
        branch_id: fixture.branchId,
        cash_session_id: sessionId
      }
    });

    expect(abono.statusCode).toBe(201);
    expect(abono.json().account.balance_cents).toBe(precio - 10000);
    expect(abono.json().allocations).toHaveLength(1);
  }, 90_000);

  it('el abono en efectivo entra al arqueo del turno', async () => {
    const { fixture, token, customerId, sessionId } = await escenario(20000, 100000);
    const precio = fixture.productPriceCents;

    await ventaFiada(fixture, token, sessionId, customerId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/customers/${customerId}/payments`,
      headers: bearerHeaders(token),
      payload: {
        amount_cents: 12000,
        method: 'CASH',
        method_code: 'CASH',
        branch_id: fixture.branchId,
        cash_session_id: sessionId
      }
    });

    const cierre = await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${sessionId}/close`,
      headers: bearerHeaders(token),
      // En el cajón solo están los 12.000 del abono: la venta fue fiada.
      payload: { closing_cash_real_cents: 12000 }
    });

    expect(cierre.statusCode).toBe(200);
    const resumen = cierre.json().summary;

    /**
     * Es el caso que descuadraba: el cliente viene a pagar su fiado, pone plata en el cajón
     * sin que haya venta, y sin contarlo el turno cerraría con 12.000 de sobrante que el
     * cajero tendría que explicar.
     */
    expect(resumen.expected_cash_cents).toBe(12000);
    expect(resumen.diff_cents).toBe(0);

    // Lo vendido y lo cobrado de deudas viejas se ven aparte.
    expect(resumen.completed_sales_total_cents).toBe(precio);
    const abonoFila = resumen.payment_breakdown.rows.find((fila: { code: string }) => fila.code === 'ABONO_CASH');
    expect(abonoFila.amount_cents).toBe(12000);
    expect(abonoFila.label).toBe('Abono · Efectivo');
  }, 90_000);

  it('no deja pasarse del cupo, ni fiar sin cupo configurado', async () => {
    const { fixture, token, customerId, sessionId } = await escenario(30000, 50000);

    const primera = await ventaFiada(fixture, token, sessionId, customerId);
    expect(primera.statusCode).toBe(201);

    // La segunda sumaría 60.000 sobre un cupo de 50.000.
    const segunda = await ventaFiada(fixture, token, sessionId, customerId);
    expect(segunda.statusCode).toBe(403);
    expect(segunda.json().error.code).toBe('CREDIT_LIMIT_EXCEEDED');

    // Un cliente sin cuenta de crédito no puede llevarse nada fiado: abrir el cupo es una
    // decisión del comercio, no algo que pase porque el cajero eligió «fiado».
    const otro = randomUUID();
    await adminDb()
      .insertInto('customers')
      .values({
        id: otro,
        tenant_id: fixture.tenantId,
        document_type: 'CC',
        document_number: `7${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`,
        name: 'Cliente sin cupo'
      })
      .execute();

    const sinCupo = await ventaFiada(fixture, token, sessionId, otro);
    expect(sinCupo.statusCode).toBe(403);
    expect(sinCupo.json().error.code).toBe('CREDIT_ACCOUNT_REQUIRED');
  }, 90_000);

  it('dos ventas fiadas simultáneas no se cuelan por encima del cupo', async () => {
    const { fixture, token, customerId, sessionId } = await escenario(30000, 50000);

    /**
     * Sin el `pg_advisory_xact_lock` por cliente, las dos leen el mismo saldo de cero y las
     * dos pasan: un cliente de 50.000 de tope acaba debiendo 60.000. Es la misma carrera
     * que la fase 7 cerró en las cuotas de plan.
     */
    const [una, otra] = await Promise.all([
      ventaFiada(fixture, token, sessionId, customerId),
      ventaFiada(fixture, token, sessionId, customerId)
    ]);

    const codigos = [una.statusCode, otra.statusCode].sort();
    expect(codigos).toEqual([201, 403]);

    const estado = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${customerId}/statement`,
      headers: bearerHeaders(token)
    });

    expect(estado.json().account.balance_cents).toBe(fixture.productPriceCents);
  }, 90_000);

  it('rechaza abonar más de lo que se debe y abonar a crédito', async () => {
    const { fixture, token, customerId, sessionId } = await escenario(20000, 100000);

    await ventaFiada(fixture, token, sessionId, customerId);

    const deMas = await app.inject({
      method: 'POST',
      url: `/api/v1/customers/${customerId}/payments`,
      headers: bearerHeaders(token),
      payload: {
        amount_cents: fixture.productPriceCents + 5000,
        method: 'CASH',
        method_code: 'CASH',
        branch_id: fixture.branchId,
        cash_session_id: sessionId
      }
    });

    expect(deMas.statusCode).toBe(400);
    expect(deMas.json().error.code).toBe('PAYMENT_EXCEEDS_DEBT');

    // Abonar «con fiado» sería la forma perfecta de hacer desaparecer una deuda.
    const conFiado = await app.inject({
      method: 'POST',
      url: `/api/v1/customers/${customerId}/payments`,
      headers: bearerHeaders(token),
      payload: {
        amount_cents: 5000,
        method: 'STORE_CREDIT',
        method_code: 'STORE_CREDIT',
        branch_id: fixture.branchId
      }
    });

    expect(conFiado.statusCode).toBe(400);
  }, 90_000);

  it('anular una venta fiada anula su deuda, salvo que ya tenga abonos', async () => {
    const { fixture, token, customerId, sessionId } = await escenario(25000, 100000);

    const venta = await ventaFiada(fixture, token, sessionId, customerId);
    const saleId = venta.json().sale.id as string;

    const anulada = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/void`,
      headers: bearerHeaders(token),
      payload: { void_reason: 'Devolución del cliente' }
    });
    expect(anulada.statusCode).toBe(200);

    const estado = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${customerId}/statement`,
      headers: bearerHeaders(token)
    });
    expect(estado.json().account.balance_cents).toBe(0);

    /* --- Con abono de por medio, la anulación se rechaza --- */
    const segunda = await ventaFiada(fixture, token, sessionId, customerId);
    const segundaId = segunda.json().sale.id as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/customers/${customerId}/payments`,
      headers: bearerHeaders(token),
      payload: {
        amount_cents: 5000,
        method: 'CASH',
        method_code: 'CASH',
        branch_id: fixture.branchId,
        cash_session_id: sessionId
      }
    });

    const conAbono = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${segundaId}/void`,
      headers: bearerHeaders(token),
      payload: { void_reason: 'Intento de anular con abono' }
    });

    /**
     * Anularla dejaría un abono imputado a un documento anulado, y el cliente habría pagado
     * por una venta que ya no existe. Devolver ese dinero es una decisión del comercio, no
     * un efecto secundario de anular.
     */
    expect(conAbono.statusCode).toBe(409);
    expect(conAbono.json().error.code).toBe('RECEIVABLE_HAS_PAYMENTS');
  }, 90_000);
});
