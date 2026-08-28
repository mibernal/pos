import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { hashPassword } from '../src/contexts/identity/auth/password.js';
import { buildApp } from '../src/app/build-app.js';
import {
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

describe('cash isolation e2e', () => {
  let app: FastifyInstance;
  let fixturesToCleanup: E2eFixture[];

  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
    fixturesToCleanup = [];
  });

  afterEach(async () => {
    for (const fixture of fixturesToCleanup.reverse()) {
      await cleanupE2eFixture(app, fixture);
    }
    fixturesToCleanup = [];
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('prevents a CASHIER from creating a sale in another user\'s cash session', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    // Cajero A
    const cashierAEmail = fixture.cashierEmail;
    const cashierAPassword = fixture.cashierPassword;
    const tokenA = await loginE2eUser(app, { email: cashierAEmail, password: cashierAPassword });

    const cashierBId = randomUUID();
    const cashierBEmail = `b.${randomUUID()}@iso.com`;
    const cashierBPassword = 'Password123!';
    const hash = await hashPassword(cashierBPassword);

    await app.db.insertInto('users').values({
      id: cashierBId,
      tenant_id: fixture.tenantId,
      email: cashierBEmail,
      name: 'Cashier B',
      role: 'CASHIER',
      password_hash: hash,
      active: true
    }).execute();

    await app.db.insertInto('user_branches').values({
      user_id: cashierBId,
      branch_id: fixture.branchId,
      tenant_id: fixture.tenantId
    }).execute();

    const tokenB = await loginE2eUser(app, { email: cashierBEmail, password: cashierBPassword });

    // Cajero A abre su caja
    const openSessionResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(tokenA),
      payload: {
        branch_id: fixture.branchId,
        terminal_id: fixture.terminalId,
        opening_amount_cents: 1000
      }
    });

    expect(openSessionResponse.statusCode).toBe(201);
    const sessionAId = (openSessionResponse.json() as any).cash_session.id;

    // Cajero B intenta vender en la caja de Cajero A
    const payload = {
      client_uuid: randomUUID(),
      branch_id: fixture.branchId,
      cash_session_id: sessionAId, // The isolated session
      items: [{ product_id: fixture.productId, qty: 1, price_cents: fixture.productPriceCents }],
      discount_cents: 0,
        tip_cents: 0,
      payments: [{ method: 'CASH', amount_cents: Math.round(fixture.productPriceCents * 1.19) }]
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(tokenB),
      payload
    });

    expect(response.statusCode).toBe(403);
    const body = response.json() as any;
    expect(body.error.code).toBe('CASH_SESSION_FORBIDDEN');
  });
});
