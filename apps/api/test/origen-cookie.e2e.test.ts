import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';

/**
 * Quién puede usar la cookie de refresco, y quién no debe quedarse fuera por el camino.
 *
 * `/auth/refresh` y `/auth/logout` se autentican con una cookie que el navegador adjunta
 * solo. Eso es lo que una página ajena puede provocar: pedirle al navegador de la víctima
 * que haga la petición, con su cookie dentro. El resto de la API va con `Authorization`, y
 * ese encabezado una página ajena no lo puede poner.
 *
 * La otra mitad de la prueba importa igual: al cerrar esto es facilísimo cerrar de más.
 * Los webhooks del PAC y de la pasarela, `/health` y `/metrics` llegan **sin** `Origin` y
 * tienen que seguir entrando. Un CORS que corta por falta de `Origin` deja el cobro
 * recurrente sin avisos y la monitorización ciega, y no lo delata nada hasta que hace
 * falta.
 */
describe('Origen en las rutas que usan la cookie', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('rechaza refresh sin cabecera Origin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { pos_refresh_token: 'da-igual-no-llega-a-mirarlo' }
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'ORIGIN_REQUIRED' } });
  });

  it('rechaza refresh desde un origen que no está en la lista', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { origin: 'https://sitio-de-otro.example' },
      cookies: { pos_refresh_token: 'da-igual-no-llega-a-mirarlo' }
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'ORIGIN_NOT_ALLOWED' } });
  });

  it('rechaza logout sin Origin, igual que refresh', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(res.statusCode).toBe(403);
  });

  it('deja pasar el origen de la aplicación: llega al token y falla por el token, no por el origen', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { origin: 'http://localhost:5173' },
      cookies: { pos_refresh_token: 'un-token-que-no-existe' }
    });

    // 401 y no 403: pasó la puerta del origen y se estrelló contra el token, que es
    // exactamente donde tiene que decidirse.
    expect(res.statusCode).toBe(401);
  });

  it('un webhook sigue entrando sin Origin', async () => {
    // Lo que se comprueba es que NO responde 403 por el origen. Que después conteste 400 o
    // 401 por la firma o el cuerpo es cosa suya, y es lo correcto.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments/wompi',
      payload: { event: 'ping' }
    });

    expect(res.statusCode).not.toBe(403);
  });

  it('/health sigue respondiendo sin Origin', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBeLessThan(400);
  });
});
