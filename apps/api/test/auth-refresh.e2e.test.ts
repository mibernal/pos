import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  cleanupE2eFixture,
  ensureE2eSchema,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

describe('auth refresh flow e2e', () => {
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

  it('login sets refresh cookie and /api/v1/auth/refresh rotates it', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    const email = fixture.cashierEmail;
    const password = fixture.cashierPassword;

    // 1. Login
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password }
    });

    expect(loginResponse.statusCode).toBe(200);
    const loginData = loginResponse.json() as any;
    expect(loginData.accessToken).toBeDefined();

    const cookies = loginResponse.cookies;
    const refreshCookie = cookies.find((c: any) => c.name === 'pos_refresh_token');
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.httpOnly).toBe(true);

    // 2. Refresh
    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: {
        pos_refresh_token: refreshCookie!.value
      }
    });

    expect(refreshResponse.statusCode).toBe(200);
    const refreshData = refreshResponse.json() as any;
    expect(refreshData.accessToken).toBeDefined();
    expect(refreshData.accessToken).toBeDefined();

    const newCookies = refreshResponse.cookies;
    const newRefreshCookie = newCookies.find((c: any) => c.name === 'pos_refresh_token');
    expect(newRefreshCookie).toBeDefined();
    expect(newRefreshCookie?.value).not.toBe(refreshCookie!.value);

    // 3. Old refresh token should be revoked (or at least server should reject reused token based on our flow)
    const badRefreshResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: {
        pos_refresh_token: refreshCookie!.value
      }
    });

    // Depends on if revocation is fully implemented. If it just rejects invalid signature it'll be 401. 
    // If it's a valid token but reused, we might not have a denylist, but standard behavior expects 401.
    expect(badRefreshResponse.statusCode).toBe(401);
  });
});
