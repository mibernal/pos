import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

/**
 * Cierre de lote de tarjeta.
 *
 * El código de aprobación se teclea a mano y hasta ahora nada lo conciliaba contra el lote
 * del adquirente: la diferencia aparecía semanas después, en la conciliación bancaria,
 * cuando ya nadie recordaba el día.
 */

describe('Cierre de lote de tarjeta', () => {
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
   * La fecha **local**, no la de UTC.
   *
   * `created_at` es un timestamp sin zona, así que el día del lote es el del reloj del
   * servidor. Con `toISOString()` esta prueba fallaba cada tarde a partir de las 19:00 en
   * Colombia, cuando en UTC ya es el día siguiente.
   */
  function hoy(): string {
    const ahora = new Date();
    return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
  }

  it('cuadra cuando el datáfono y el sistema coinciden, y señala la diferencia cuando no', async () => {
    const fixture = await seedE2eFixture(app, { productPriceCents: 45000 });
    fixtures.push(fixture);
    const precio = fixture.productPriceCents;

    const token = await loginE2eUser(app, { email: fixture.adminEmail, password: fixture.adminPassword });

    const turno = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(token),
      payload: { branch_id: fixture.branchId, terminal_id: fixture.terminalId, opening_amount_cents: 0 }
    });
    const sessionId = turno.json().cash_session.id as string;

    for (const aprobacion of ['A100', 'A200']) {
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
          payments: [{ method: 'CARD', amount_cents: precio, approval_code: aprobacion }]
        }
      });
      expect(venta.statusCode).toBe(201);
    }

    /* --- Lo que el sistema registró, antes de capturar el cierre --- */
    const previa = await app.inject({
      method: 'GET',
      url: `/api/v1/card-batches/preview?branch_id=${fixture.branchId}&batch_date=${hoy()}`,
      headers: bearerHeaders(token)
    });

    expect(previa.statusCode).toBe(200);
    expect(previa.json().system_total_cents).toBe(precio * 2);
    expect(previa.json().system_count).toBe(2);
    // Los códigos de aprobación salen para poder buscar el que sobra o falta.
    expect(previa.json().transactions.map((t: { approval_code: string }) => t.approval_code)).toEqual(['A100', 'A200']);

    /* --- El datáfono trae una transacción de más: se señala --- */
    const conDiferencia = await app.inject({
      method: 'POST',
      url: '/api/v1/card-batches',
      headers: bearerHeaders(token),
      payload: {
        branch_id: fixture.branchId,
        acquirer: 'REDEBAN',
        batch_date: hoy(),
        declared_total_cents: precio * 3,
        declared_count: 3
      }
    });

    expect(conDiferencia.statusCode).toBe(201);
    expect(conDiferencia.json().status).toBe('MISMATCHED');
    expect(conDiferencia.json().diff_cents).toBe(precio);

    /* --- Conciliar dos veces el mismo lote son dos verdades sobre el mismo dinero --- */
    const repetido = await app.inject({
      method: 'POST',
      url: '/api/v1/card-batches',
      headers: bearerHeaders(token),
      payload: {
        branch_id: fixture.branchId,
        acquirer: 'REDEBAN',
        batch_date: hoy(),
        declared_total_cents: precio * 2,
        declared_count: 2
      }
    });

    expect(repetido.statusCode).toBe(409);
    expect(repetido.json().error.code).toBe('CARD_BATCH_ALREADY_RECONCILED');

    /* --- Otro adquirente sí puede cerrar su propio lote del mismo día --- */
    const otro = await app.inject({
      method: 'POST',
      url: '/api/v1/card-batches',
      headers: bearerHeaders(token),
      payload: {
        branch_id: fixture.branchId,
        acquirer: 'CREDIBANCO',
        batch_date: hoy(),
        declared_total_cents: precio * 2,
        declared_count: 2
      }
    });

    expect(otro.statusCode).toBe(201);
    expect(otro.json().status).toBe('MATCHED');
    expect(otro.json().diff_cents).toBe(0);
  }, 90_000);
});
