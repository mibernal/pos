import { createHmac, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import { adminDb, cleanupE2eFixture, ensureE2eSchema, seedE2eFixture, type E2eFixture } from './helpers/e2e-fixture.js';

/**
 * Webhook del PAC.
 *
 * Es un endpoint público que puede marcar una factura como aceptada o rechazada, así que lo
 * que importa comprobar es lo que *no* debe pasar: que se acepte sin firma, que una
 * notificación dirigida a un comercio alcance los documentos de otro, o que un webhook
 * repetido reabra un documento ya resuelto.
 */

const WEBHOOK_SECRET = 'secreto-de-prueba-para-el-webhook-dian';

let app: FastifyInstance;
const fixtures: E2eFixture[] = [];
let previousSecret: string | undefined;

function sign(body: unknown): { payload: string; signature: string } {
  const payload = JSON.stringify(body);
  return { payload, signature: createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex') };
}

async function seedSentDocument(fixture: E2eFixture, overrides: { cude?: string } = {}) {
  const cashSessionId = randomUUID();
  const saleId = randomUUID();
  const documentId = randomUUID();

  await sql`
    INSERT INTO cash_sessions (id, tenant_id, branch_id, terminal_id, opened_by_user_id, opening_amount_cents, status)
    VALUES (${cashSessionId}, ${fixture.tenantId}, ${fixture.branchId}, ${fixture.terminalId},
            ${fixture.adminUserId}, 0, 'OPEN')
  `.execute(adminDb());

  await sql`
    INSERT INTO sales (id, tenant_id, branch_id, cash_session_id, sale_number, client_uuid,
                       created_by_user_id, subtotal_cents, discount_cents, tax_total_cents,
                       total_cents, payment_json, tax_lines_json, status)
    VALUES (${saleId}, ${fixture.tenantId}, ${fixture.branchId}, ${cashSessionId}, 77001,
            ${randomUUID()}, ${fixture.adminUserId}, 1000, 0, 0, 1000, '{}'::jsonb, '[]'::jsonb, 'COMPLETED')
  `.execute(adminDb());

  await sql`
    INSERT INTO dian_documents (id, tenant_id, sale_id, document_type, provider, status,
                                cude, provider_payload_json)
    VALUES (${documentId}, ${fixture.tenantId}, ${saleId}, 'INVOICE', 'mock', 'SENT',
            ${overrides.cude ?? null}, '{}'::jsonb)
  `.execute(adminDb());

  return { documentId, saleId, cashSessionId };
}

async function readStatus(documentId: string): Promise<string> {
  const { rows } = await sql<{ status: string }>`
    SELECT status FROM dian_documents WHERE id = ${documentId}
  `.execute(adminDb());
  return rows[0]!.status;
}

describe('Webhook de estado del PAC', () => {
  beforeAll(async () => {
    previousSecret = process.env.DIAN_WEBHOOK_SECRET;
    process.env.DIAN_WEBHOOK_SECRET = WEBHOOK_SECRET;
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    for (const fixture of fixtures) {
      await adminDb().deleteFrom('dian_documents').where('tenant_id', '=', fixture.tenantId).execute();
      await sql`DELETE FROM sales WHERE tenant_id = ${fixture.tenantId}`.execute(adminDb());
      await sql`DELETE FROM cash_sessions WHERE tenant_id = ${fixture.tenantId}`.execute(adminDb());
      await cleanupE2eFixture(app, fixture);
    }
    await app.close();
    if (previousSecret === undefined) delete process.env.DIAN_WEBHOOK_SECRET;
    else process.env.DIAN_WEBHOOK_SECRET = previousSecret;
  });

  async function newFixture() {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    return fixture;
  }

  it('resuelve un documento SENT a ACCEPTED cuando la firma es válida', async () => {
    const fixture = await newFixture();
    const { documentId } = await seedSentDocument(fixture);

    const body = { document_id: documentId, status: 'ACCEPTED', cude: 'CUDE-REAL-123' };
    const { payload, signature } = sign(body);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/dian/${fixture.tenantId}/status`,
      headers: { 'content-type': 'application/json', 'x-dian-signature': signature },
      payload
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ received: true, applied: true });
    expect(await readStatus(documentId)).toBe('ACCEPTED');
  });

  it('rechaza una notificación sin firma o con firma equivocada', async () => {
    const fixture = await newFixture();
    const { documentId } = await seedSentDocument(fixture);

    const body = { document_id: documentId, status: 'ACCEPTED', cude: 'CUDE-FALSO' };
    const { payload } = sign(body);

    const noSignature = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/dian/${fixture.tenantId}/status`,
      headers: { 'content-type': 'application/json' },
      payload
    });
    expect(noSignature.statusCode).toBe(401);

    const badSignature = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/dian/${fixture.tenantId}/status`,
      headers: { 'content-type': 'application/json', 'x-dian-signature': 'a'.repeat(64) },
      payload
    });
    expect(badSignature.statusCode).toBe(401);

    // Y lo que importa: el documento sigue como estaba.
    expect(await readStatus(documentId)).toBe('SENT');
  });

  it('una notificación dirigida a un comercio no alcanza los documentos de otro', async () => {
    const victim = await newFixture();
    const attacker = await newFixture();
    const { documentId } = await seedSentDocument(victim);

    // Firma válida, pero la ruta apunta al otro comercio.
    const body = { document_id: documentId, status: 'ACCEPTED', cude: 'CUDE-AJENO' };
    const { payload, signature } = sign(body);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/dian/${attacker.tenantId}/status`,
      headers: { 'content-type': 'application/json', 'x-dian-signature': signature },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ applied: false, reason: 'DOCUMENT_NOT_FOUND' });
    expect(await readStatus(documentId)).toBe('SENT');
  });

  it('no reabre un documento ya resuelto', async () => {
    const fixture = await newFixture();
    const { documentId } = await seedSentDocument(fixture);

    const accept = sign({ document_id: documentId, status: 'ACCEPTED', cude: 'CUDE-1' });
    await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/dian/${fixture.tenantId}/status`,
      headers: { 'content-type': 'application/json', 'x-dian-signature': accept.signature },
      payload: accept.payload
    });

    const reject = sign({ document_id: documentId, status: 'REJECTED' });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/dian/${fixture.tenantId}/status`,
      headers: { 'content-type': 'application/json', 'x-dian-signature': reject.signature },
      payload: reject.payload
    });

    expect(second.json()).toMatchObject({ applied: false, reason: 'ALREADY_RESOLVED' });
    expect(await readStatus(documentId)).toBe('ACCEPTED');
  });

  it('identifica el documento por CUDE cuando el PAC no manda el id interno', async () => {
    const fixture = await newFixture();
    const cude = `CUDE-${randomUUID()}`;
    const { documentId } = await seedSentDocument(fixture, { cude });

    const body = { cude, status: 'REJECTED', rejection_reason: 'NIT del adquiriente inválido' };
    const { payload, signature } = sign(body);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/dian/${fixture.tenantId}/status`,
      headers: { 'content-type': 'application/json', 'x-dian-signature': signature },
      payload
    });

    expect(response.json()).toMatchObject({ applied: true });
    expect(await readStatus(documentId)).toBe('REJECTED');
  });

  it('acepta con 200 un documento desconocido, para no provocar reintentos en bucle', async () => {
    const fixture = await newFixture();

    const body = { document_id: randomUUID(), status: 'ACCEPTED', cude: 'CUDE-X' };
    const { payload, signature } = sign(body);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/dian/${fixture.tenantId}/status`,
      headers: { 'content-type': 'application/json', 'x-dian-signature': signature },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ applied: false, reason: 'DOCUMENT_NOT_FOUND' });
  });
});
