import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';

let app: FastifyInstance;

describe('fiscal routes rbac', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects tax profile and tax category updates for CASHIER role', async () => {
    const cashierToken = app.jwt.sign({
      sub: 'cashier-user-id',
      userId: 'cashier-user-id',
      tenantId: '11111111-1111-4111-8111-111111111111',
      role: 'CASHIER',
      email: 'cashier@demo.posdian.local',
      name: 'Cajero Demo'
    });

    const taxProfileResponse = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/tenants/11111111-1111-4111-8111-111111111111/tax-profile',
      headers: {
        authorization: `Bearer ${cashierToken}`,
        'content-type': 'application/json'
      },
      payload: {
        taxMode: 'INC_RESTAURANT'
      }
    });

    expect(taxProfileResponse.statusCode).toBe(403);

    const productTaxCategoryResponse = await app.inject({
      method: 'PATCH',
      url: '/api/v1/products/44444444-4444-4444-8444-444444444444',
      headers: {
        authorization: `Bearer ${cashierToken}`,
        'content-type': 'application/json'
      },
      payload: {
        taxCategory: 'IVA_5'
      }
    });

    expect(productTaxCategoryResponse.statusCode).toBe(403);
  });
});
