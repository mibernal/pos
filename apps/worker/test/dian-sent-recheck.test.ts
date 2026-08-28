import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cierre del ciclo de los documentos que quedan en `SENT`.
 *
 * La versión anterior de este scheduler reencolaba el evento para *reemitir*, y la guarda de
 * idempotencia del procesador lo descartaba de inmediato: el documento seguía en `SENT` y
 * cada ciclo dejaba una fila más en la bandeja de salida. Un bucle que no cerraba nada.
 * Estas pruebas fijan el comportamiento correcto: preguntar, aplicar el desenlace, y avisar
 * cuando no hay forma de resolverlo.
 */

const connectionString =
  process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://pos@127.0.0.1:5432/pos_dian';

const queryStatus = vi.fn();

vi.mock('../src/providers/index.js', () => ({
  buildDianProvider: () => ({
    emitSale: vi.fn(),
    queryStatus
  })
}));

const { recheckStuckDianDocuments } = await import('../src/scheduler/dian-sent-recheck.scheduler.js');

const pool = new Pool({ connectionString, max: 4 });

let tenantId: string;
let branchId: string;
let userId: string;
let terminalId: string;
let cashSessionId: string;
let saleCounter = 500000;

async function seedDocument(options: { hoursAgo: number; cude?: string | null }): Promise<string> {
  const saleId = randomUUID();
  const documentId = randomUUID();

  await pool.query(
    `INSERT INTO sales (id, tenant_id, branch_id, cash_session_id, sale_number, client_uuid,
                        created_by_user_id, subtotal_cents, discount_cents, tax_total_cents,
                        total_cents, payment_json, tax_lines_json, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1000, 0, 0, 1000, '{}'::jsonb, '[]'::jsonb, 'COMPLETED')`,
    [saleId, tenantId, branchId, cashSessionId, saleCounter++, randomUUID(), userId]
  );

  await pool.query(
    `INSERT INTO dian_documents (id, tenant_id, sale_id, document_type, provider, status, cude,
                                 provider_payload_json, prefix, document_number, updated_at)
     VALUES ($1, $2, $3, 'INVOICE', 'http', 'SENT', $4, '{}'::jsonb, 'SETP', $5,
             NOW() - ($6 || ' hours')::interval)`,
    [documentId, tenantId, saleId, options.cude ?? null, saleCounter, String(options.hoursAgo)]
  );

  return documentId;
}

async function statusOf(documentId: string): Promise<string> {
  const { rows } = await pool.query<{ status: string }>(`SELECT status FROM dian_documents WHERE id = $1`, [
    documentId
  ]);
  return rows[0]!.status;
}

async function alertCount(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM outbox_events
     WHERE tenant_id = $1 AND type = 'dian_document.unresolved'`,
    [tenantId]
  );
  return Number(rows[0]!.count);
}

describe('Reconsulta de documentos DIAN en SENT', () => {
  beforeAll(async () => {
    tenantId = randomUUID();
    branchId = randomUUID();
    userId = randomUUID();
    terminalId = randomUUID();
    cashSessionId = randomUUID();

    await pool.query(
      `INSERT INTO tenants (id, name, nit, business_name, address) VALUES ($1, 'Recheck', $2, 'Recheck SAS', 'Calle 2')`,
      [tenantId, `NIT-${tenantId.slice(0, 8)}`]
    );
    await pool.query(`INSERT INTO branches (id, tenant_id, name, address) VALUES ($1, $2, 'Sede', 'Calle 2')`, [
      branchId,
      tenantId
    ]);
    await pool.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ($1, $2, $3, 'x', 'Admin', 'ADMIN')`,
      [userId, tenantId, `recheck.${tenantId.slice(0, 8)}@test.local`]
    );
    await pool.query(`INSERT INTO terminals (id, tenant_id, branch_id, name) VALUES ($1, $2, $3, 'Caja')`, [
      terminalId,
      tenantId,
      branchId
    ]);
    await pool.query(
      `INSERT INTO cash_sessions (id, tenant_id, branch_id, terminal_id, opened_by_user_id, opening_amount_cents, status)
       VALUES ($1, $2, $3, $4, $5, 0, 'OPEN')`,
      [cashSessionId, tenantId, branchId, terminalId, userId]
    );
    await pool.query(
      `INSERT INTO tenant_dian_settings (tenant_id, provider_name, credentials, test_mode)
       VALUES ($1, 'HTTP_GENERIC', '{"url":"https://pac.test/api","apiKey":"k"}'::jsonb, true)`,
      [tenantId]
    );
  });

  beforeEach(async () => {
    queryStatus.mockReset();
    await pool.query(`DELETE FROM outbox_events WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM dian_documents WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM sales WHERE tenant_id = $1`, [tenantId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM outbox_events WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM dian_documents WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM sales WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM tenant_dian_settings WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM cash_sessions WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM terminals WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM branches WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await pool.end();
  });

  it('resuelve a ACCEPTED cuando el PAC lo confirma, y guarda el CUDE', async () => {
    const documentId = await seedDocument({ hoursAgo: 1 });
    queryStatus.mockResolvedValue({ status: 'ACCEPTED', cude: 'CUDE-CONFIRMADO', raw: { ok: true } });

    const outcome = await recheckStuckDianDocuments(pool);

    expect(outcome.resolved).toBe(1);
    expect(await statusOf(documentId)).toBe('ACCEPTED');

    const { rows } = await pool.query<{ cude: string }>(`SELECT cude FROM dian_documents WHERE id = $1`, [
      documentId
    ]);
    expect(rows[0]!.cude).toBe('CUDE-CONFIRMADO');
  });

  it('resuelve a REJECTED cuando el PAC lo rechaza', async () => {
    const documentId = await seedDocument({ hoursAgo: 1 });
    queryStatus.mockResolvedValue({ status: 'REJECTED', cude: null, raw: { motivo: 'NIT inválido' } });

    await recheckStuckDianDocuments(pool);

    expect(await statusOf(documentId)).toBe('REJECTED');
  });

  it('no reemite: solo consulta', async () => {
    // Reemitir un documento ya enviado podría hacer que el PAC lo acepte dos veces. El
    // scheduler solo pregunta, y no debe dejar eventos de emisión en la bandeja.
    await seedDocument({ hoursAgo: 1 });
    queryStatus.mockResolvedValue({ status: 'ACCEPTED', cude: 'CUDE-1', raw: {} });

    await recheckStuckDianDocuments(pool);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM outbox_events
       WHERE tenant_id = $1 AND type IN ('sale.created', 'sale.voided')`,
      [tenantId]
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('deja el documento como está cuando el PAC responde UNKNOWN', async () => {
    // `UNKNOWN` es «no sé decírtelo ahora», no un rechazo. Inventar un desenlace aquí sería
    // marcar como rechazada una factura que la DIAN podría haber aceptado.
    const documentId = await seedDocument({ hoursAgo: 1 });
    queryStatus.mockResolvedValue({ status: 'UNKNOWN', cude: null, raw: {} });

    const outcome = await recheckStuckDianDocuments(pool);

    expect(outcome.resolved).toBe(0);
    expect(outcome.stillPending).toBe(1);
    expect(await statusOf(documentId)).toBe('SENT');
  });

  it('alerta cuando un documento lleva demasiadas horas sin resolverse, y solo una vez al día', async () => {
    await seedDocument({ hoursAgo: 30 });
    queryStatus.mockResolvedValue({ status: 'UNKNOWN', cude: null, raw: {} });

    const first = await recheckStuckDianDocuments(pool);
    expect(first.alerted).toBe(1);
    expect(await alertCount()).toBe(1);

    // Un documento atascado no debe generar una alerta cada diez minutos: una bandeja con
    // doscientas alertas iguales es una bandeja que nadie mira.
    const second = await recheckStuckDianDocuments(pool);
    expect(second.alerted).toBe(0);
    expect(await alertCount()).toBe(1);
  });

  it('no alerta por un documento recién enviado', async () => {
    await seedDocument({ hoursAgo: 1 });
    queryStatus.mockResolvedValue({ status: 'UNKNOWN', cude: null, raw: {} });

    const outcome = await recheckStuckDianDocuments(pool);

    expect(outcome.alerted).toBe(0);
    expect(await alertCount()).toBe(0);
  });

  it('ignora los documentos demasiado recientes para reconsultar', async () => {
    // El corte por defecto son 10 minutos: preguntar a los dos segundos solo gasta llamadas.
    await seedDocument({ hoursAgo: 0 });
    queryStatus.mockResolvedValue({ status: 'ACCEPTED', cude: 'X', raw: {} });

    const outcome = await recheckStuckDianDocuments(pool);

    expect(outcome.checked).toBe(0);
    expect(queryStatus).not.toHaveBeenCalled();
  });

  it('un fallo de la consulta no tumba el ciclo ni cambia el documento', async () => {
    const documentId = await seedDocument({ hoursAgo: 2 });
    queryStatus.mockRejectedValue(new Error('PAC caído'));

    const outcome = await recheckStuckDianDocuments(pool);

    expect(outcome.stillPending).toBe(1);
    expect(await statusOf(documentId)).toBe('SENT');
  });
});
