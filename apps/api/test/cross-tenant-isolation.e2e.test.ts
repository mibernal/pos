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
import { randomUUID } from 'node:crypto';

describe('Cross-Tenant Isolation E2E', () => {
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

  it('prevents Tenant B from viewing sales of Tenant A', async () => {
    // Seed Tenant A and create a sale
    const fixtureA = await seedE2eFixture(app);
    fixturesToCleanup.push(fixtureA);
    const adminTokenA = await loginE2eUser(app, {
      email: fixtureA.adminEmail,
      password: fixtureA.adminPassword
    });

    const openRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(adminTokenA),
      payload: {
        branch_id: fixtureA.branchId,
        terminal_id: fixtureA.terminalId,
        opening_amount_cents: 1000
      }
    });
    const sessionAId = (openRes.json() as any).cash_session.id;

    const saleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(adminTokenA),
      payload: {
        client_uuid: '77777777-7777-4777-8777-777777777777',
        branch_id: fixtureA.branchId,
        cash_session_id: sessionAId,
        items: [{ product_id: fixtureA.productId, qty: 1, price_cents: fixtureA.productPriceCents }],
        discount_cents: 0,
        tip_cents: 0,
        payments: [{ method: 'CASH', amount_cents: fixtureA.productPriceCents }]
      }
    });
    expect(saleRes.statusCode).toBe(201);
    const saleIdA = (saleRes.json() as any).sale.id;

    // Seed Tenant B
    const fixtureB = await seedE2eFixture(app);
    fixturesToCleanup.push(fixtureB);
    const adminTokenB = await loginE2eUser(app, {
      email: fixtureB.adminEmail,
      password: fixtureB.adminPassword
    });

    // Tenant B tries to fetch Tenant A's sale
    const fetchRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/${saleIdA}`,
      headers: bearerHeaders(adminTokenB)
    });

    expect(fetchRes.statusCode).toBe(404); // Should be completely invisible (404)
  });

  it('prevents Tenant B from listing products of Tenant A', async () => {
    const fixtureA = await seedE2eFixture(app);
    fixturesToCleanup.push(fixtureA);

    const fixtureB = await seedE2eFixture(app);
    fixturesToCleanup.push(fixtureB);
    const adminTokenB = await loginE2eUser(app, {
      email: fixtureB.adminEmail,
      password: fixtureB.adminPassword
    });

    // List products
    const productsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: bearerHeaders(adminTokenB)
    });

    expect(productsRes.statusCode).toBe(200);
    const productsBody = productsRes.json() as any;
    const productsList = productsBody.items;

    // Ensure Tenant A's product is NOT in the list
    const foundProductA = productsList.find((p: any) => p.id === fixtureA.productId);
    expect(foundProductA).toBeUndefined();

    // Ensure Tenant B's product IS in the list
    const foundProductB = productsList.find((p: any) => p.id === fixtureB.productId);
    expect(foundProductB).toBeDefined();
  });

  it('prevents user from opening cash session in an unassigned branch', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    // Create a secondary branch manually in the same tenant
    const secondaryBranchId = randomUUID();
    await app.db.insertInto('branches').values({
      id: secondaryBranchId,
      tenant_id: fixture.tenantId,
      name: 'Secondary Branch',
      address: 'Another address'
    }).execute();

    const secondaryTerminalId = randomUUID();
    await app.db.insertInto('terminals').values({
      id: secondaryTerminalId,
      tenant_id: fixture.tenantId,
      branch_id: secondaryBranchId,
      name: 'Secondary Terminal'
    }).execute();

    const cashierToken = await loginE2eUser(app, {
      email: fixture.cashierEmail,
      password: fixture.cashierPassword
    });

    // The fixture does not explicitly set `user_branches` for the Cashier, 
    // but typically a Cashier might only have access to their assigned branch.
    // However, if no user_branches are defined, the system might block access to ALL branches
    // or allow all branches. Let's assume the user is assigned only to fixture.branchId.
    // Let's insert the assignment just in case.
    await app.db.insertInto('user_branches').values({
      user_id: fixture.cashierUserId,
      branch_id: fixture.branchId,
      tenant_id: fixture.tenantId
    }).onConflict((oc) => oc.doNothing()).execute();

    const openRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(cashierToken),
      payload: {
        branch_id: secondaryBranchId,
        terminal_id: secondaryTerminalId,
        opening_amount_cents: 1000
      }
    });

    // Should be forbidden because user doesn't have access to secondaryBranchId
    expect(openRes.statusCode).toBe(403);
    expect((openRes.json() as any).error.code).toBe('AUTH_FORBIDDEN');
  });
});
