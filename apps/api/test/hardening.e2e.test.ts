import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

/**
 * Endurecimiento de la superficie HTTP (fase 3).
 *
 * Estas pruebas cubren tres cosas que estuvieron abiertas: las cabeceras de seguridad, el
 * token de sesión aceptado por la URL en cualquier ruta, y `/metrics` sin autenticación.
 */

let app: FastifyInstance;
const fixtures: E2eFixture[] = [];

describe('Superficie HTTP endurecida', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    for (const fixture of fixtures) {
      await cleanupE2eFixture(app, fixture);
    }
    await app.close();
  });

  it('responde con las cabeceras de seguridad de helmet', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    // Sin CSP a propósito: la API sirve JSON y Swagger, no el HTML de la aplicación.
    expect(response.headers['content-security-policy']).toBeUndefined();
  });

  it('no acepta el token de sesión por la URL fuera de los streams SSE', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    // Con la cabecera, la petición funciona.
    const withHeader = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: bearerHeaders(token)
    });
    expect(withHeader.statusCode).toBe(200);

    // Con el mismo token en la query, no. Un JWT en la URL queda en los registros del
    // proxy, en el historial del navegador y en la cabecera `Referer` hacia terceros.
    const withQuery = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/users?token=${token}`
    });
    expect(withQuery.statusCode).toBe(401);
  });

  it('los streams SSE sí aceptan el token por la URL, porque EventSource no manda cabeceras', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard/stream?token=${token}`,
      payloadAsStream: true
    });

    // Lo que se comprueba es que la autenticación pasa: un 401 significaría que se rompió
    // el único caso legítimo del token en la URL.
    expect(response.statusCode).not.toBe(401);
    response.stream().destroy();
  });

  it('fuera de producción /metrics queda accesible para el desarrollo local', async () => {
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('process_cpu_user_seconds_total');
  });
});
