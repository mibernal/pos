import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  adminDb,
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

/**
 * El canje de una sesión de suplantación exige la sesión de plataforma que la pidió.
 *
 * Hasta la fase 14 `/auth/impersonate/exchange` era pública: con el `session_id` —que queda
 * escrito en `audit_logs` y lo puede leer el ADMIN del comercio— cualquiera salía con un
 * token del dueño durante una hora.
 */
let app: FastifyInstance;
let fixture: E2eFixture;
const sessionId = randomUUID();

describe('Suplantación: el canje no es público', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
    fixture = await seedE2eFixture(app);

    await adminDb()
      .insertInto('impersonation_sessions')
      .values({
        id: sessionId,
        platform_user_id: fixture.adminUserId,
        target_user_id: fixture.adminUserId,
        target_tenant_id: fixture.tenantId,
        reason: 'prueba',
        expires_at: new Date(Date.now() + 60 * 60 * 1000)
      })
      .execute();
  });

  afterAll(async () => {
    await adminDb().deleteFrom('impersonation_sessions').where('id', '=', sessionId).execute();
    await cleanupE2eFixture(app, fixture);
    await app.close();
  });

  it('sin sesión no canjea nada', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/impersonate/exchange',
      payload: { session_id: sessionId }
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('accessToken');
  });

  it('un usuario del comercio, aunque sea ADMIN, tampoco', async () => {
    const token = await loginE2eUser(app, { email: fixture.adminEmail, password: fixture.adminPassword });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/impersonate/exchange',
      headers: bearerHeaders(token),
      payload: { session_id: sessionId }
    });
    expect(response.statusCode).toBe(403);
  });

  it('cerrar una sesión ajena sin autenticarse ya no es posible', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/impersonate/stop',
      payload: { session_id: sessionId }
    });
    expect(response.statusCode).toBe(401);

    const fila = await adminDb()
      .selectFrom('impersonation_sessions')
      .select('revoked_at')
      .where('id', '=', sessionId)
      .executeTakeFirstOrThrow();
    expect(fila.revoked_at).toBeNull();
  });
});
