import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

describe('Cash Reconciliation Flow E2E', () => {
  let app: FastifyInstance;
  let fixturesToCleanup: E2eFixture[] = [];

  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    for (const fixture of fixturesToCleanup.reverse()) {
      await cleanupE2eFixture(app, fixture);
    }
    fixturesToCleanup = [];
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows a cashier to declare cash and an admin to reconcile the session', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    const cashierToken = await loginE2eUser(app, {
      email: fixture.cashierEmail,
      password: fixture.cashierPassword
    });

    const adminToken = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    // 1. Open session
    const openRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(cashierToken),
      payload: {
        branch_id: fixture.branchId,
        terminal_id: fixture.terminalId,
        opening_amount_cents: 50000 // 50.000
      }
    });
    expect(openRes.statusCode).toBe(201);
    const sessionId = (openRes.json() as any).cash_session.id;

    // 2. Cashier registers a sale of 10.000 in cash
    const saleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(cashierToken),
      payload: {
        client_uuid: '77777777-7777-4777-8777-777777777777',
        branch_id: fixture.branchId,
        cash_session_id: sessionId,
        items: [
          {
            product_id: fixture.productId,
            qty: 1,
            price_cents: 11900
          }
        ],
        discount_cents: 0,
        payments: [
          {
            method: 'CASH',
            amount_cents: 14161
          }
        ]
      }
    });
    if (saleRes.statusCode !== 201) {
      console.error('SALE RES ERROR', saleRes.json());
    }
    expect(saleRes.statusCode).toBe(201);

    // Expected cash is now 64.161. 
    // 3. Cashier declares 63.161 (missing 1.000)
    const declareRes = await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${sessionId}/declare`,
      headers: bearerHeaders(cashierToken),
      payload: {
        declared_amount_cents: 63161
      }
    });
    expect(declareRes.statusCode).toBe(200);

    const checkDeclaredRes = await app.inject({
      method: 'GET',
      url: '/api/v1/cash-sessions/active',
      headers: bearerHeaders(cashierToken)
    });
    const declaredData = checkDeclaredRes.json() as any;
    expect(declaredData.status).toBe('COUNTED'); // Changed status locally? Usually active endpoint returns it

    // 4. Admin reconciles the session
    const reconcileRes = await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${sessionId}/reconcile`,
      headers: bearerHeaders(adminToken),
      payload: {
        notes: 'Faltante de 1.000 justificado'
      }
    });
    expect(reconcileRes.statusCode).toBe(200);
    const sessionClosed = reconcileRes.json() as any;
    expect(sessionClosed.cash_session.status).toBe('CLOSED');
    expect(sessionClosed.audit.diff_cents).toBe(-1000); // 59000 - 60000 = -1000
  });
});
