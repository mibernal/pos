import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  cleanupE2eFixture,
  ensureE2eSchema,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

/**
 * Lo que sale por el cable del panel en vivo tiene que ser el objeto, no su texto.
 *
 * Esta prueba existe por un defecto que no rompió nada y por eso duró: la ruta serializaba
 * el payload y `writeEvent` lo serializaba otra vez. Por el cable viajaba un JSON dentro de
 * un JSON; el navegador desenvuelve una capa y se queda con un `string` donde espera el
 * objeto, así que `stats.total_revenue_cents` era `undefined` y la tarjeta de la caja del
 * día enseñaba «$ NaN» al dueño del negocio.
 *
 * No falló ninguna prueba, ni el tipado —`writeEvent` recibía `any`—, ni la ruta: devolvía
 * 200 y un `data:` perfectamente formado. Por eso se comprueba aquí lo mismo que hace el
 * navegador: leer la primera trama y desenvolverla **una** vez.
 */

/** Lee la primera trama `data:` del flujo y corta. Un SSE no termina solo. */
async function primeraTrama(url: string, token: string): Promise<string> {
  const corte = new AbortController();
  const respuesta = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: corte.signal
  });

  expect(respuesta.status).toBe(200);

  const lector = respuesta.body!.getReader();
  const decodificador = new TextDecoder();
  let acumulado = '';

  try {
    while (!acumulado.includes('\n\n')) {
      const { value, done } = await lector.read();
      if (done) break;
      acumulado += decodificador.decode(value, { stream: true });
    }
  } finally {
    corte.abort();
  }

  const linea = acumulado.split('\n').find((l) => l.startsWith('data: '));
  if (!linea) throw new Error(`El flujo no envió ninguna trama de datos: ${JSON.stringify(acumulado)}`);
  return linea.slice('data: '.length);
}

describe('Flujo en vivo del panel', () => {
  let app: FastifyInstance;
  let direccion: string;
  const fixtures: E2eFixture[] = [];

  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const puerto = (app.server.address() as { port: number }).port;
    direccion = `http://127.0.0.1:${puerto}`;
  }, 60_000);

  afterAll(async () => {
    for (const fixture of fixtures.reverse()) {
      await cleanupE2eFixture(app, fixture);
    }
    await app.close();
  });

  it('entrega un objeto con las cifras, no una cadena con un objeto dentro', async () => {
    const fixture = await seedE2eFixture(app, { productPriceCents: 30_000 });
    fixtures.push(fixture);
    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    const crudo = await primeraTrama(
      `${direccion}/api/v1/dashboard/stream?branch_id=${fixture.branchId}`,
      token
    );

    const payload = JSON.parse(crudo);

    // El corazón de la prueba. Con la doble serialización esto era un `string`, y todo lo
    // de abajo salía `undefined` sin que nada protestara.
    expect(typeof payload).toBe('object');
    expect(payload).not.toBeNull();

    expect(typeof payload.total_revenue_cents).toBe('number');
    expect(Number.isNaN(payload.total_revenue_cents)).toBe(false);
    expect(typeof payload.total_sales_count).toBe('number');
    expect(typeof payload.total_inventory_value_cents).toBe('number');
    expect(Array.isArray(payload.chart_data)).toBe(true);
  }, 60_000);
});
