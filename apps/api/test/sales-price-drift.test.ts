import { expect, test, describe, beforeAll, afterAll, afterEach } from 'vitest';
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
import { randomUUID } from 'node:crypto';

describe('Sales - Price Drift & Snapshots', () => {
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

  async function openCashSession(
    app: FastifyInstance,
    token: string,
    branchId: string,
    terminalId: string,
    openingAmountCents = 10000
  ) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(token),
      payload: {
        branch_id: branchId,
        terminal_id: terminalId,
        opening_amount_cents: openingAmountCents
      }
    });

    expect(response.statusCode).toBe(201);
    const json = response.json() as any;
    return json.cash_session.id;
  }

  test('accepts sale with exact snapshot', async () => {
    const fixture = await seedE2eFixture(app, {
      taxMode: 'IVA',
      productTaxCategory: 'IVA_19',
      productPriceCents: 10000 // Base 8403, IVA 1597
    });
    fixturesToCleanup.push(fixture);

    const adminToken = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    const cashSessionId = await openCashSession(app, adminToken, fixture.branchId, fixture.terminalId);

    const qty = 2;
    // 10000 * 2 = 20000 (inc IVA 19)
    // base = 20000 / 1.19 = 16807, iva = 3193
    const payload = {
      client_uuid: randomUUID(),
      branch_id: fixture.branchId,
      cash_session_id: cashSessionId,
      items: [{
        product_id: fixture.productId,
        qty: qty,
        price_cents: fixture.productPriceCents
      }],
      discount_cents: 0,
        tip_cents: 0,
      payments: [{
        method: 'CASH',
        amount_cents: fixture.productPriceCents * qty
      }],
      snapshot: {
        subtotal_cents: fixture.productPriceCents * qty,
        discount_cents: 0,
        tip_cents: 0,
        tax_total_cents: 3193,
        total_cents: fixture.productPriceCents * qty
      }
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(adminToken),
      payload
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as any;
    expect(body.sale.total_cents).toBe(20000);
    expect(body.sale.tax_total_cents).toBe(3193);
  });

  test('accepts sale with acceptable drift (<= 10%) and respects snapshot', async () => {
    const fixture = await seedE2eFixture(app, {
      taxMode: 'IVA',
      productTaxCategory: 'IVA_19',
      productPriceCents: 10000
    });
    fixturesToCleanup.push(fixture);

    const adminToken = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    const cashSessionId = await openCashSession(app, adminToken, fixture.branchId, fixture.terminalId);

    // Let's say client charged 10500 per item instead of 10000 (drift 5%)
    const clientPrice = 10500;
    const qty = 2;
    const expectedSubtotal = clientPrice * qty; // 21000
    // base = 21000 / 1.19 = 17647, iva = 3353

    const payload = {
      client_uuid: randomUUID(),
      branch_id: fixture.branchId,
      cash_session_id: cashSessionId,
      items: [{
        product_id: fixture.productId,
        qty: qty,
        price_cents: clientPrice
      }],
      discount_cents: 0,
        tip_cents: 0,
      payments: [{
        method: 'CASH',
        amount_cents: expectedSubtotal
      }],
      snapshot: {
        subtotal_cents: expectedSubtotal,
        discount_cents: 0,
        tip_cents: 0,
        tax_total_cents: 3353,
        total_cents: expectedSubtotal
      }
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(adminToken),
      payload
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as any;

    // The server normally computes 20000 for this product, but because it's offline drift < 10%, 
    // it MUST respect the snapshot totals.
    expect(body.sale.total_cents).toBe(expectedSubtotal);
    expect(body.sale.tax_total_cents).toBe(3353);
    expect(body.items[0].price_cents).toBe(clientPrice);
  });

  test('rejects sale with unacceptable drift (> 10%)', async () => {
    const fixture = await seedE2eFixture(app, {
      taxMode: 'IVA',
      productTaxCategory: 'IVA_19',
      productPriceCents: 10000
    });
    fixturesToCleanup.push(fixture);

    const adminToken = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    const cashSessionId = await openCashSession(app, adminToken, fixture.branchId, fixture.terminalId);

    // Client charged 12000 instead of 10000 (drift 20%)
    const clientPrice = 12000;
    const qty = 2;
    const expectedSubtotal = clientPrice * qty; // 24000

    const payload = {
      client_uuid: randomUUID(),
      branch_id: fixture.branchId,
      cash_session_id: cashSessionId,
      items: [{
        product_id: fixture.productId,
        qty: qty,
        price_cents: clientPrice
      }],
      discount_cents: 0,
        tip_cents: 0,
      payments: [{
        method: 'CASH',
        amount_cents: expectedSubtotal
      }],
      snapshot: {
        subtotal_cents: expectedSubtotal,
        discount_cents: 0,
        tip_cents: 0,
        tax_total_cents: 3832,
        total_cents: expectedSubtotal
      }
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(adminToken),
      payload
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as any;
    expect(body.code).toBe('PRICE_DRIFT_EXCEEDED');
  });
});
