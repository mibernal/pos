import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';

let app: FastifyInstance;

describe('cash sessions routes access', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects open without token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      payload: {
        branch_id: '22222222-2222-4222-8222-222222222222',
        terminal_id: '33333333-3333-4333-8333-333333333333',
        opening_amount_cents: 10000
      }
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects close without token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/55555555-5555-4555-8555-555555555555/close',
      payload: {
        closing_cash_real_cents: 12000
      }
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects current without token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/cash-sessions/current?terminal_id=22222222-2222-4222-8222-222222222222'
    });

    expect(response.statusCode).toBe(401);
  });
});
