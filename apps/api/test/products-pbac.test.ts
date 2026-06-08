import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';

let app: FastifyInstance;

describe('products routes pbac', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects GET /products without token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/products'
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects POST /products without products:manage permission', async () => {
    const cashierToken = app.jwt.sign({
      sub: 'cashier-user-id',
      userId: 'cashier-user-id',
      tenantId: '11111111-1111-4111-8111-111111111111',
      role: 'CASHIER',
    isPlatformRole: false,
      email: 'cashier@demo.posdian.local',
      name: 'Cajero Demo'
    , branchIds: ['00000000-0000-0000-0000-000000000000'], permissions: ['sales:create']});

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: {
        authorization: `Bearer ${cashierToken}`,
        'content-type': 'application/json'
      },
      payload: {
        name: 'Producto Prueba',
        category: 'Bebidas',
        price_cents: 1000,
        barcode: '1234567890'
      }
    });

    expect(response.statusCode).toBe(403);
  });
});
