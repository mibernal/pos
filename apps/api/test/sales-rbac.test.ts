import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';

let app: FastifyInstance;

describe('sales routes access', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects create sale without token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      payload: {
        client_uuid: '77777777-7777-4777-8777-777777777777',
        branch_id: '22222222-2222-4222-8222-222222222222',
        cash_session_id: '55555555-5555-4555-8555-555555555555',
        items: [{ product_id: '44444444-4444-4444-8444-444444444444', qty: 1 }],
        discount_cents: 0,
        payments: [{ method: 'CASH', amount_cents: 1000 }]
      }
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects list sales without token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sales?branch_id=22222222-2222-4222-8222-222222222222'
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects get sale by id without token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/66666666-6666-4666-8666-666666666666'
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects void sale for CASHIER role', async () => {
    const cashierToken = app.jwt.sign({
      sub: 'cashier-user-id',
      userId: 'cashier-user-id',
      tenantId: '11111111-1111-4111-8111-111111111111',
      role: 'CASHIER',
      email: 'cashier@demo.posdian.local',
      name: 'Cajero Demo'
    , branchIds: ['00000000-0000-0000-0000-000000000000'], permissions: ['sales:create', 'sales:void', 'returns:create', 'inventory:adjust', 'inventory:transfer', 'inventory:receive', 'reports:view', 'cash:reconcile', 'cash:audit', 'settings:manage']});

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/66666666-6666-4666-8666-666666666666/void',
      headers: {
        authorization: `Bearer ${cashierToken}`
      },
      payload: {
        void_reason: 'No autorizado'
      }
    });

    expect(response.statusCode).toBe(403);
  });
});
