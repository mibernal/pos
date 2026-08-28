import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
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
 * Resoluciones de facturación y numeración fiscal.
 *
 * El punto de estas pruebas no es el CRUD: es que la numeración no se pueda duplicar ni
 * saltar. Un número repetido lo rechaza el PAC; un hueco hay que justificarlo ante la DIAN
 * meses después, cuando ya nadie recuerda qué pasó.
 */

let app: FastifyInstance;
const fixtures: E2eFixture[] = [];

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function cleanupResolutions(tenantId: string) {
  await adminDb().deleteFrom('dian_documents').where('tenant_id', '=', tenantId).execute();
  await sql`DELETE FROM dian_resolutions WHERE tenant_id = ${tenantId}`.execute(adminDb());
}

describe('Resoluciones de facturación DIAN', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    for (const fixture of fixtures) {
      await cleanupResolutions(fixture.tenantId);
      await cleanupE2eFixture(app, fixture);
    }
    await app.close();
  });

  async function seedTenantWithToken() {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });
    return { fixture, token };
  }

  it('carga una resolución y calcula cuánto queda y cuánto falta para vencer', async () => {
    const { fixture, token } = await seedTenantWithToken();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(token),
      payload: {
        resolution_number: '18764000001234',
        resolution_date: isoDaysFromNow(-10),
        prefix: 'SETP',
        range_from: 990000000,
        range_to: 990001000,
        valid_from: isoDaysFromNow(-10),
        valid_until: isoDaysFromNow(180),
        alert_threshold: 100
      }
    });

    expect(response.statusCode, response.body).toBe(201);
    const body = response.json();

    expect(body.prefix).toBe('SETP');
    // Aún no se ha emitido nada: el siguiente documento se lleva el primer número del rango.
    expect(body.next_number).toBe(990000000);
    expect(body.remaining).toBe(1001);
    expect(body.days_until_expiry).toBeGreaterThan(170);
    expect(body.health).toBe('OK');
    void fixture;
  });

  it('rechaza un rango invertido y una vigencia al revés', async () => {
    const { token } = await seedTenantWithToken();

    const badRange = await app.inject({
      method: 'POST',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(token),
      payload: {
        resolution_number: 'R-1',
        resolution_date: isoDaysFromNow(-1),
        prefix: 'AAA',
        range_from: 500,
        range_to: 100,
        valid_from: isoDaysFromNow(-1),
        valid_until: isoDaysFromNow(30)
      }
    });
    expect(badRange.statusCode).toBe(400);
    expect(badRange.json().error.code).toBe('VALIDATION_ERROR');

    const badValidity = await app.inject({
      method: 'POST',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(token),
      payload: {
        resolution_number: 'R-2',
        resolution_date: isoDaysFromNow(-1),
        prefix: 'AAA',
        range_from: 100,
        range_to: 500,
        valid_from: isoDaysFromNow(30),
        valid_until: isoDaysFromNow(1)
      }
    });
    expect(badValidity.statusCode).toBe(400);
  });

  it('cargar una resolución nueva desactiva la anterior: nunca dos series en paralelo', async () => {
    const { fixture, token } = await seedTenantWithToken();

    const base = {
      resolution_date: isoDaysFromNow(-5),
      valid_from: isoDaysFromNow(-5),
      valid_until: isoDaysFromNow(200),
      range_from: 1,
      range_to: 1000
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(token),
      payload: { ...base, resolution_number: 'R-VIEJA', prefix: 'OLD' }
    });
    expect(first.statusCode, first.body).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(token),
      payload: { ...base, resolution_number: 'R-NUEVA', prefix: 'NEW' }
    });
    expect(second.statusCode, second.body).toBe(201);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(token)
    });
    const rows = listed.json() as Array<{ prefix: string; is_active: boolean }>;

    expect(rows.filter((r) => r.is_active)).toHaveLength(1);
    expect(rows.find((r) => r.is_active)?.prefix).toBe('NEW');
    void fixture;
  });

  it('avisa cuando el rango está por agotarse y cuando la vigencia está por vencer', async () => {
    const { token } = await seedTenantWithToken();

    const lowRange = await app.inject({
      method: 'POST',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(token),
      payload: {
        resolution_number: 'R-CORTA',
        resolution_date: isoDaysFromNow(-5),
        prefix: 'LOW',
        range_from: 1,
        range_to: 50,
        valid_from: isoDaysFromNow(-5),
        valid_until: isoDaysFromNow(300),
        alert_threshold: 100
      }
    });
    // Quedan 50 números y el umbral es 100: el aviso se enciende desde el primer día.
    expect(lowRange.json().health).toBe('LOW_RANGE');

    const expiring = await app.inject({
      method: 'POST',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(token),
      payload: {
        resolution_number: 'R-VENCE',
        resolution_date: isoDaysFromNow(-5),
        prefix: 'EXP',
        range_from: 1,
        range_to: 100000,
        valid_from: isoDaysFromNow(-5),
        valid_until: isoDaysFromNow(10),
        alert_threshold: 10
      }
    });
    expect(expiring.json().health).toBe('EXPIRING');
  });

  it('permite arrancar en un número intermedio al migrar desde otra herramienta', async () => {
    const { token } = await seedTenantWithToken();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(token),
      payload: {
        resolution_number: 'R-MIGRADA',
        resolution_date: isoDaysFromNow(-30),
        prefix: 'MIG',
        range_from: 1000,
        range_to: 2000,
        start_at: 1450,
        valid_from: isoDaysFromNow(-30),
        valid_until: isoDaysFromNow(120)
      }
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().next_number).toBe(1450);

    const outOfRange = await app.inject({
      method: 'POST',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(token),
      payload: {
        resolution_number: 'R-MALA',
        resolution_date: isoDaysFromNow(-30),
        prefix: 'BAD',
        range_from: 1000,
        range_to: 2000,
        start_at: 5000,
        valid_from: isoDaysFromNow(-30),
        valid_until: isoDaysFromNow(120)
      }
    });
    expect(outOfRange.statusCode).toBe(400);
  });

  it('un comercio no ve las resoluciones de otro', async () => {
    const a = await seedTenantWithToken();
    const b = await seedTenantWithToken();

    await app.inject({
      method: 'POST',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(a.token),
      payload: {
        resolution_number: 'R-DE-A',
        resolution_date: isoDaysFromNow(-1),
        prefix: 'AAA',
        range_from: 1,
        range_to: 100,
        valid_from: isoDaysFromNow(-1),
        valid_until: isoDaysFromNow(90)
      }
    });

    const seenByB = await app.inject({
      method: 'GET',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(b.token)
    });

    expect(seenByB.statusCode).toBe(200);
    expect(seenByB.json()).toEqual([]);
  });

  it('un cajero no puede cargar ni listar resoluciones', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    const cashierToken = await loginE2eUser(app, {
      email: fixture.cashierEmail,
      password: fixture.cashierPassword
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(cashierToken)
    });
    expect(listed.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/dian/resolutions',
      headers: bearerHeaders(cashierToken),
      payload: {
        resolution_number: 'R-X',
        resolution_date: isoDaysFromNow(-1),
        prefix: 'XXX',
        range_from: 1,
        range_to: 10,
        valid_from: isoDaysFromNow(-1),
        valid_until: isoDaysFromNow(10)
      }
    });
    expect(created.statusCode).toBe(403);
  });

  it('el índice único impide dos documentos con el mismo número fiscal', async () => {
    const { fixture } = await seedTenantWithToken();

    const saleA = randomUUID();
    const saleB = randomUUID();

    // Dos ventas mínimas de las que colgar los documentos.
    const cashSessionId = randomUUID();
    await sql`
      INSERT INTO cash_sessions (id, tenant_id, branch_id, terminal_id, opened_by_user_id,
                                 opening_amount_cents, status)
      VALUES (${cashSessionId}, ${fixture.tenantId}, ${fixture.branchId}, ${fixture.terminalId},
              ${fixture.adminUserId}, 0, 'OPEN')
    `.execute(adminDb());

    let saleNumber = 90000;
    for (const saleId of [saleA, saleB]) {
      await sql`
        INSERT INTO sales (id, tenant_id, branch_id, cash_session_id, sale_number, client_uuid,
                           created_by_user_id, subtotal_cents, discount_cents, tax_total_cents,
                           total_cents, payment_json, tax_lines_json, status)
        VALUES (${saleId}, ${fixture.tenantId}, ${fixture.branchId}, ${cashSessionId},
                ${saleNumber++}, ${randomUUID()}, ${fixture.adminUserId}, 1000, 0, 0, 1000,
                '{}'::jsonb, '[]'::jsonb, 'COMPLETED')
      `.execute(adminDb());
    }

    const insertDocument = (saleId: string) => sql`
      INSERT INTO dian_documents (id, tenant_id, sale_id, document_type, provider, status,
                                  provider_payload_json, prefix, document_number)
      VALUES (${randomUUID()}, ${fixture.tenantId}, ${saleId}, 'INVOICE', 'mock', 'SENT',
              '{}'::jsonb, 'DUP', 777)
    `.execute(adminDb());

    await insertDocument(saleA);
    // El segundo choca contra el índice en vez de llegar a la DIAN con el número repetido.
    await expect(insertDocument(saleB)).rejects.toThrow(/duplicate key|unique/i);

    await sql`DELETE FROM dian_documents WHERE sale_id IN (${saleA}, ${saleB})`.execute(adminDb());
    await sql`DELETE FROM sales WHERE id IN (${saleA}, ${saleB})`.execute(adminDb());
    await sql`DELETE FROM cash_sessions WHERE id = ${cashSessionId}`.execute(adminDb());
  });
});
