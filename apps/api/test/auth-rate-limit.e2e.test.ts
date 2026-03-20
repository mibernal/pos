import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import { resetLoginRateLimitStore } from '../src/infra/security/login-rate-limit.js';
import {
  cleanupE2eFixture,
  ensureE2eSchema,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

describe('auth hardening e2e', () => {
  let app: FastifyInstance;
  let fixturesToCleanup: E2eFixture[];

  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
    fixturesToCleanup = [];
  });

  afterEach(async () => {
    resetLoginRateLimitStore();

    for (const fixture of fixturesToCleanup.reverse()) {
      await cleanupE2eFixture(app, fixture);
    }

    fixturesToCleanup = [];
  });

  afterAll(async () => {
    await app.close();
  });

  it('normalizes email before authenticating', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: `  ${fixture.adminEmail.toUpperCase()}  `,
        password: fixture.adminPassword
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: {
        email: fixture.adminEmail
      }
    });
  });

  it('rate limits repeated failed login attempts', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: fixture.adminEmail,
          password: 'WrongPassword123*'
        }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Credenciales inválidas'
      });
    }

    const blockedResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: fixture.adminEmail,
        password: 'WrongPassword123*'
      }
    });

    expect(blockedResponse.statusCode).toBe(429);
    expect(blockedResponse.json()).toMatchObject({
      code: 'AUTH_RATE_LIMITED',
      message: 'Demasiados intentos de inicio de sesión. Intenta de nuevo más tarde.'
    });
  });
});
