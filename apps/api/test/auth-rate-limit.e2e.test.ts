import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import { resetLoginRateLimitStore } from '../src/shared/infra/security/login-rate-limit.js';
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
    if (app.redis && typeof app.redis.flushall === 'function') {
      await app.redis.flushall();
    }
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
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Credenciales inválidas'
        }
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
    // El contrato de error de la API es `{ error: { code, message, details } }`
    // (shared/plugins/error-handler.ts). Antes estas pruebas afirmaban el formato por
    // defecto de Fastify, que era lo que realmente salía porque el manejador de errores
    // no estaba registrado con `fastify-plugin` y quedaba fuera del alcance de las rutas.
    expect(blockedResponse.json()).toMatchObject({
      error: {
        code: 'AUTH_RATE_LIMITED',
        message: 'Demasiados intentos de inicio de sesión. Intenta de nuevo más tarde.'
      }
    });
  });

  it('prevents race conditions with concurrent requests', async () => {
    const fixture = await seedE2eFixture(app);
    fixturesToCleanup.push(fixture);

    // Enviar 10 requests concurrentes para probar race conditions en el límite de 5 intentos
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: fixture.adminEmail,
          password: 'WrongPassword123*'
        }
      }));
    }

    const responses = await Promise.all(promises);

    let unauthorizedCount = 0;
    let rateLimitedCount = 0;

    for (const res of responses) {
      if (res.statusCode === 401) unauthorizedCount++;
      if (res.statusCode === 429) rateLimitedCount++;
    }

    // Exactamente 5 deberían fallar con 401 (Credenciales inválidas)
    // Exactamente 5 deberían ser bloqueados con 429 (Rate Limit)
    // Si hubiera race condition, más de 5 recibirían 401.
    expect(unauthorizedCount).toBe(5);
    expect(rateLimitedCount).toBe(5);
  });
});
