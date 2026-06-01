import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

  return response.json() as {
    cash_session: {
      id: string;
      branch_id: string;
      opening_amount_cents: number;
      closed_at: string | null;
    };
  };
}

async function createSale(
  app: FastifyInstance,
  token: string,
  fixture: E2eFixture,
  cashSessionId: string
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/sales',
    headers: bearerHeaders(token),
    payload: {
      client_uuid: randomUUID(),
      branch_id: fixture.branchId,
      cash_session_id: cashSessionId,
      items: [
        {
          product_id: fixture.productId,
          qty: 1
        }
      ],
      discount_cents: 0,
      payments: [
        {
          method: 'CASH',
          amount_cents: Math.round(fixture.productPriceCents * 1.19)
        }
      ]
    }
  });
  if (response.statusCode !== 201) {
    console.error('CREATE SALE FAILED:', response.json());
  }
  expect(response.statusCode).toBe(201);

  return response.json() as {
    sale: {
      id: string;
      branch_id: string;
      sale_number: number;
      status: 'COMPLETED' | 'VOID';
      subtotal_cents: number;
      discount_cents: number;
      total_cents: number;
      tax_total_cents: number;
      tax_lines_json: Array<Record<string, unknown>>;
      dian_status: 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | null;
      void_reason: string | null;
      voided_by_user_id: string | null;
      voided_at: string | null;
    };
  };
}

describe('system flow e2e', () => {
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

  it('login -> open cash session -> create sale -> verify outbox event', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    const cashierToken = await loginE2eUser(app, {
      email: fixture.cashierEmail,
      password: fixture.cashierPassword
    });

    // 1. Initial inventory balance
    const initialBalanceResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/balances?branch_id=${fixture.branchId}&product_id=${fixture.productId}`,
      headers: bearerHeaders(cashierToken)
    });
    if (initialBalanceResponse.statusCode !== 200) {
      console.error('INVENTORY BALANCES FAILED:', initialBalanceResponse.json());
    }
    expect(initialBalanceResponse.statusCode).toBe(200);
    const initialBalanceJson = initialBalanceResponse.json() as any[];
    const initialQty = initialBalanceJson[0]?.on_hand_qty ?? 0;

    const openedSession = await openCashSession(app, cashierToken, fixture.branchId, fixture.terminalId, 5000);
    const createdSale = await createSale(app, cashierToken, fixture, openedSession.cash_session.id);

    expect(createdSale.sale.sale_number).toBe(1);
    expect(createdSale.sale.status).toBe('COMPLETED');

    const dianDocument = await app.db
      .selectFrom('dian_documents')
      .select(['status'])
      .where('tenant_id', '=', fixture.tenantId)
      .where('sale_id', '=', createdSale.sale.id)
      .executeTakeFirst();

    expect(dianDocument?.status).toBe('PENDING');

    const outboxEvent = await app.db
      .selectFrom('outbox_events')
      .select(['type', 'aggregate_type', 'aggregate_id', 'branch_id', 'status', 'payload_json'])
      .where('tenant_id', '=', fixture.tenantId)
      .where('aggregate_id', '=', createdSale.sale.id)
      .executeTakeFirst();

    expect(outboxEvent).toMatchObject({
      type: 'sale.created',
      aggregate_type: 'SALE',
      aggregate_id: createdSale.sale.id,
      branch_id: fixture.branchId,
      status: 'PENDING',
      payload_json: expect.objectContaining({
        sale_id: createdSale.sale.id,
        branch_id: fixture.branchId,
        cash_session_id: openedSession.cash_session.id,
        total_cents: fixture.productPriceCents
      })
    });

    // 2. Final inventory balance should be initialQty - 1
    const finalBalanceResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/balances?branch_id=${fixture.branchId}&product_id=${fixture.productId}`,
      headers: bearerHeaders(cashierToken)
    });
    expect(finalBalanceResponse.statusCode).toBe(200);
    const finalBalanceJson = finalBalanceResponse.json() as any[];
    const finalQty = finalBalanceJson[0]?.on_hand_qty ?? 0;
    
    // In test DB without seed inventory balance, qty might be negative or undefined initially, but it must be decreased by 1
    expect(finalQty).toBe(initialQty - 1);
  });

  it('persists fiscal tax fields when creating a sale', async () => {
    const fixture = await seedE2eFixture(app, {
      taxMode: 'IVA',
      productTaxCategory: 'IVA_19',
      productPriceCents: 11900
    });
    fixturesToCleanup.push(fixture);

    const adminToken = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });
    const openedSession = await openCashSession(app, adminToken, fixture.branchId, fixture.terminalId, 0);
    const createdSale = await createSale(app, adminToken, fixture, openedSession.cash_session.id);

    expect(createdSale.sale.tax_total_cents).toBe(1900);
    expect(createdSale.sale.tax_lines_json).toEqual([
      {
        line_index: 0,
        category: 'IVA_19',
        base_cents: 10000,
        tax_cents: 1900,
        rate: 0.19
      }
    ]);

    const persistedSale = await app.db
      .selectFrom('sales')
      .select(['tax_total_cents', 'tax_lines_json', 'total_cents'])
      .where('tenant_id', '=', fixture.tenantId)
      .where('id', '=', createdSale.sale.id)
      .executeTakeFirst();

    expect(persistedSale).toMatchObject({
      tax_total_cents: 1900,
      total_cents: 11900,
      tax_lines_json: [
        {
          line_index: 0,
          category: 'IVA_19',
          base_cents: 10000,
          tax_cents: 1900,
          rate: 0.19
        }
      ]
    });
  });

  it('voids a sale as ADMIN', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    const adminToken = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });
    const openedSession = await openCashSession(app, adminToken, fixture.branchId, fixture.terminalId, 0);
    const createdSale = await createSale(app, adminToken, fixture, openedSession.cash_session.id);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${createdSale.sale.id}/void`,
      headers: bearerHeaders(adminToken),
      payload: {
        void_reason: 'Cliente devolvió la compra'
      }
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      sale: {
        status: 'VOID';
        void_reason: string;
        voided_by_user_id: string;
        voided_at: string;
      };
    };

    expect(body.sale).toMatchObject({
      status: 'VOID',
      void_reason: 'Cliente devolvió la compra',
      voided_by_user_id: fixture.adminUserId
    });
    expect(body.sale.voided_at).toBeTruthy();

    const persistedSale = await app.db
      .selectFrom('sales')
      .select(['status', 'void_reason', 'voided_by_user_id', 'voided_at'])
      .where('tenant_id', '=', fixture.tenantId)
      .where('id', '=', createdSale.sale.id)
      .executeTakeFirst();

    expect(persistedSale?.status).toBe('VOID');
    expect(persistedSale?.void_reason).toBe('Cliente devolvió la compra');
    expect(persistedSale?.voided_by_user_id).toBe(fixture.adminUserId);
    expect(persistedSale?.voided_at).toBeInstanceOf(Date);
  });

  it('does not allow CASHIER to void a sale', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    const adminToken = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });
    const cashierToken = await loginE2eUser(app, {
      email: fixture.cashierEmail,
      password: fixture.cashierPassword
    });
    const openedSession = await openCashSession(app, adminToken, fixture.branchId, fixture.terminalId, 0);
    const createdSale = await createSale(app, adminToken, fixture, openedSession.cash_session.id);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${createdSale.sale.id}/void`,
      headers: bearerHeaders(cashierToken),
      payload: {
        void_reason: 'Intento sin permisos'
      }
    });

    expect(response.statusCode).toBe(403);

    const persistedSale = await app.db
      .selectFrom('sales')
      .select(['status', 'void_reason', 'voided_by_user_id'])
      .where('tenant_id', '=', fixture.tenantId)
      .where('id', '=', createdSale.sale.id)
      .executeTakeFirst();

    expect(persistedSale).toMatchObject({
      status: 'COMPLETED',
      void_reason: null,
      voided_by_user_id: null
    });
  });

  it('returns current cash session and completes the close flow', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    const cashierToken = await loginE2eUser(app, {
      email: fixture.cashierEmail,
      password: fixture.cashierPassword
    });
    const openedSession = await openCashSession(app, cashierToken, fixture.branchId, fixture.terminalId, 10000);

    const currentResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/cash-sessions/current?terminal_id=${fixture.terminalId}`,
      headers: bearerHeaders(cashierToken)
    });

    expect(currentResponse.statusCode).toBe(200);
    expect(currentResponse.json()).toMatchObject({
      cash_session: {
        id: openedSession.cash_session.id,
        branch_id: fixture.branchId,
        opening_amount_cents: 10000,
        closed_at: null
      }
    });

    await createSale(app, cashierToken, fixture, openedSession.cash_session.id);

    const adminToken = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    const closeResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${openedSession.cash_session.id}/close`,
      headers: bearerHeaders(adminToken),
      payload: {
        closing_cash_real_cents: 21900
      }
    });

    expect(closeResponse.statusCode).toBe(200);
    expect(closeResponse.json()).toMatchObject({
      cash_session: {
        id: openedSession.cash_session.id,
        branch_id: fixture.branchId,
        opening_amount_cents: 10000,
        closing_cash_real_cents: 21900
      },
      summary: {
        completed_sales_count: 1,
        expected_cash_cents: 21900,
        diff_cents: 0
      }
    });

    const currentAfterCloseResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/cash-sessions/current?terminal_id=${fixture.terminalId}`,
      headers: bearerHeaders(cashierToken)
    });

    expect(currentAfterCloseResponse.statusCode).toBe(200);
    expect(currentAfterCloseResponse.json()).toEqual({
      cash_session: null
    });
  });

  it('allows ADMIN to reconcile a closed session', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    const cashierToken = await loginE2eUser(app, {
      email: fixture.cashierEmail,
      password: fixture.cashierPassword
    });
    
    const openedSession = await openCashSession(app, cashierToken, fixture.branchId, fixture.terminalId, 10000);
    await createSale(app, cashierToken, fixture, openedSession.cash_session.id);

    const adminToken = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${openedSession.cash_session.id}/close`,
      headers: bearerHeaders(adminToken),
      payload: { closing_cash_real_cents: 20000 } // 1900 cents difference (expected 21900)
    });

    const reconcileResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${openedSession.cash_session.id}/reconcile`,
      headers: bearerHeaders(adminToken),
      payload: {
        resolution_notes: 'Faltante cobrado al cajero'
      }
    });

    expect(reconcileResponse.statusCode).toBe(201);

    const checkSession = await app.db
      .selectFrom('cash_sessions')
      .select(['status'])
      .where('id', '=', openedSession.cash_session.id)
      .executeTakeFirst();

    expect(checkSession?.status).toBe('RECONCILED');

    const checkReconciliation = await app.db
      .selectFrom('cash_reconciliations')
      .select(['reconciled_by_user_id', 'resolution_notes'])
      .where('cash_session_id', '=', openedSession.cash_session.id)
      .executeTakeFirst();

    expect(checkReconciliation).toMatchObject({
      reconciled_by_user_id: fixture.adminUserId,
      resolution_notes: 'Faltante cobrado al cajero'
    });
  });
});
