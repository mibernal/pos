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

    // 3. SEC: Token Reuse Detection
    // Intentar usar el token viejo (que ya fue revocado en el paso 2).
    // Esto debe disparar la revocación de TODA la familia de tokens (incluyendo el nuevo).
    const badRefreshResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: {
        pos_refresh_token: refreshCookie!.value
      }
    });

    expect(badRefreshResponse.statusCode).toBe(401);
    const badData = badRefreshResponse.json() as any;
    expect(badData.error.code).toBe('AUTH_TOKEN_REUSE_DETECTED');

    // 4. Verificar que no queden tokens activos para el usuario
    const userTokens = await app.db
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('user_id', '=', loginData.user.id)
      .where('revoked_at', 'is', null)
      .execute();

    expect(userTokens.length).toBe(0);

    // 5. El nuevo token también debería fallar si intentamos usarlo (porque fue revocado por la medida de seguridad)
    const newRefreshFailsResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: {
        pos_refresh_token: newRefreshCookie!.value
      }
    });
    
    expect(newRefreshFailsResponse.statusCode).toBe(401);
  });
});
