import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { buildApp } from '../src/app/build-app.js';
import {
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

describe('Outbox Events E2E', () => {
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

  it('creates a sale.created outbox event when a sale is completed', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    const token = await loginE2eUser(app, {
      email: fixture.cashierEmail,
      password: fixture.cashierPassword
    });

    const openRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(token),
      payload: {
        branch_id: fixture.branchId,
        terminal_id: fixture.terminalId,
        opening_amount_cents: 1000
      }
    });
    const sessionId = (openRes.json() as any).cash_session.id;

    const saleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(token),
      payload: {
        client_uuid: '77777777-7777-4777-8777-777777777777',
        branch_id: fixture.branchId,
        cash_session_id: sessionId,
        items: [{ product_id: fixture.productId, qty: 1, price_cents: fixture.productPriceCents }],
        discount_cents: 0,
        payments: [{ method: 'CASH', amount_cents: fixture.productPriceCents }]
      }
    });
    if (saleRes.statusCode !== 201) {
      console.error('Failed to create sale:', saleRes.body);
    }
    expect(saleRes.statusCode).toBe(201);
    const saleId = (saleRes.json() as any).sale.id;

    // Check that an outbox event was created
    const { rows } = await sql<{ id: string; type: string; aggregate_id: string }>`
      SELECT id, type, aggregate_id FROM outbox_events WHERE tenant_id = ${fixture.tenantId} AND aggregate_id = ${saleId}
    `.execute(app.db);

    expect(rows.length).toBeGreaterThan(0);
    const saleCreatedEvent = rows.find((r: any) => r.type === 'sale.created');
    expect(saleCreatedEvent).toBeDefined();
    expect(saleCreatedEvent!.aggregate_id).toBe(saleId);
  });

  it('creates a sale.voided outbox event when a sale is voided', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    const adminToken = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    const openRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(adminToken),
      payload: {
        branch_id: fixture.branchId,
        terminal_id: fixture.terminalId,
        opening_amount_cents: 1000
      }
    });
    const sessionId = (openRes.json() as any).cash_session.id;

    const saleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(adminToken),
      payload: {
        client_uuid: '77777777-7777-4777-8777-777777777777',
        branch_id: fixture.branchId,
        cash_session_id: sessionId,
        items: [{ product_id: fixture.productId, qty: 1, price_cents: fixture.productPriceCents }],
        discount_cents: 0,
        payments: [{ method: 'CASH', amount_cents: fixture.productPriceCents }]
      }
    });
    const saleId = (saleRes.json() as any).sale.id;

    // Void the sale
    const voidRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/void`,
      headers: bearerHeaders(adminToken),
      payload: {
        void_reason: 'Error in E2E test'
      }
    });
    expect(voidRes.statusCode).toBe(200);

    const { rows } = await sql<{ id: string; type: string; aggregate_id: string }>`
      SELECT id, type, aggregate_id FROM outbox_events WHERE tenant_id = ${fixture.tenantId} AND aggregate_id = ${saleId}
    `.execute(app.db);

    const saleVoidedEvent = rows.find((r: any) => r.type === 'sale.voided');
    expect(saleVoidedEvent).toBeDefined();
    expect(saleVoidedEvent!.aggregate_id).toBe(saleId);
  });

  it.skip('creates a low_stock.alert outbox event when stock falls below min_stock_alert_qty', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    const token = await loginE2eUser(app, {
      email: fixture.cashierEmail,
      password: fixture.cashierPassword
    });

    // 1. Give the product a min_stock_alert_qty of 5 and current stock of 6
    await app.db.updateTable('products')
      .set({ min_stock_alert_qty: 5 })
      .where('id', '=', fixture.productId)
      .execute();

    await app.db.insertInto('inventory_balances').values({
      tenant_id: fixture.tenantId,
      branch_id: fixture.branchId,
      product_id: fixture.productId,
      on_hand_qty: '10'
    }).execute();

    // 2. Open session
    const openRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(token),
      payload: {
        branch_id: fixture.branchId,
        terminal_id: fixture.terminalId,
        opening_amount_cents: 1000
      }
    });
    const sessionId = (openRes.json() as any).cash_session.id;

    // 3. Sell 2 items (stock goes to 4, which is < 5)
    const saleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(token),
      payload: {
        client_uuid: '77777777-7777-4777-8777-777777777777',
        branch_id: fixture.branchId,
        cash_session_id: sessionId,
        items: [{ product_id: fixture.productId, qty: 2, price_cents: fixture.productPriceCents }],
        discount_cents: 0,
        payments: [{ method: 'CASH', amount_cents: fixture.productPriceCents * 2 }]
      }
    });
    expect(saleRes.statusCode).toBe(201);

    // 4. Verify the outbox event for LOW_STOCK_ALERT was created
    const { rows } = await sql<{ id: string; type: string; aggregate_id: string }>`
      SELECT id, type, aggregate_id FROM outbox_events WHERE tenant_id = ${fixture.tenantId} AND aggregate_id = ${fixture.productId}
    `.execute(app.db);

    const lowStockAlertEvent = rows.find((r: any) => r.type === 'low_stock.alert');
    expect(lowStockAlertEvent).toBeDefined();
    expect(lowStockAlertEvent!.aggregate_id).toBe(fixture.productId);
  });
});
