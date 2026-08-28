import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assignDocumentNumber, FiscalNumberingError } from '../src/jobs/shared/fiscal-numbering.js';

/**
 * Numeración fiscal, contra PostgreSQL real.
 *
 * Es la parte del sistema donde un doble de base de datos no sirve para nada: lo que hay
 * que comprobar es el comportamiento del motor —el lock de fila que serializa a dos
 * workers, el rollback que devuelve el número al rango, el índice único que impide el
 * duplicado—, no el código que lo envuelve.
 */

const connectionString =
  process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://pos@127.0.0.1:5432/pos_dian';

const pool = new Pool({ connectionString, max: 6 });

let tenantId: string;
let branchId: string;
let userId: string;
let cashSessionId: string;
let terminalId: string;

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function createResolution(overrides: Partial<{
  prefix: string;
  rangeFrom: number;
  rangeTo: number;
  startAt: number;
  validFrom: string;
  validUntil: string;
  alertThreshold: number;
  isActive: boolean;
}> = {}): Promise<string> {
  const id = randomUUID();
  const rangeFrom = overrides.rangeFrom ?? 1000;
  const rangeTo = overrides.rangeTo ?? 1999;

  await pool.query(
    `INSERT INTO dian_resolutions
       (id, tenant_id, branch_id, document_type, resolution_number, resolution_date, prefix,
        range_from, range_to, current_number, valid_from, valid_until, alert_threshold, is_active)
     VALUES ($1, $2, NULL, 'INVOICE', $3, $4::date, $5, $6, $7, $8, $9::date, $10::date, $11, $12)`,
    [
      id,
      tenantId,
      `RES-${id.slice(0, 8)}`,
      isoDaysFromNow(-30),
      overrides.prefix ?? 'TST',
      rangeFrom,
      rangeTo,
      (overrides.startAt ?? rangeFrom) - 1,
      overrides.validFrom ?? isoDaysFromNow(-30),
      overrides.validUntil ?? isoDaysFromNow(180),
      overrides.alertThreshold ?? 100,
      overrides.isActive ?? true
    ]
  );

  return id;
}

async function createDocument(): Promise<string> {
  const saleId = randomUUID();
  const documentId = randomUUID();

  await pool.query(
    `INSERT INTO sales (id, tenant_id, branch_id, cash_session_id, sale_number, client_uuid,
                        created_by_user_id, subtotal_cents, discount_cents, tax_total_cents,
                        total_cents, payment_json, tax_lines_json, status)
     VALUES ($1, $2, $3, $4, nextval('sales_seq_dummy_test'), $5, $6, 1000, 0, 0, 1000,
             '{}'::jsonb, '[]'::jsonb, 'COMPLETED')`,
    [saleId, tenantId, branchId, cashSessionId, randomUUID(), userId]
  );

  await pool.query(
    `INSERT INTO dian_documents (id, tenant_id, sale_id, document_type, provider, status, provider_payload_json)
     VALUES ($1, $2, $3, 'INVOICE', 'mock', 'PENDING', '{}'::jsonb)`,
    [documentId, tenantId, saleId]
  );

  return documentId;
}

describe('Numeración fiscal DIAN', () => {
  beforeAll(async () => {
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS sales_seq_dummy_test START 800000`);

    tenantId = randomUUID();
    branchId = randomUUID();
    userId = randomUUID();
    terminalId = randomUUID();
    cashSessionId = randomUUID();

    await pool.query(
      `INSERT INTO tenants (id, name, nit, business_name, address) VALUES ($1, 'Numeración', $2, 'Numeración SAS', 'Calle 1')`,
      [tenantId, `NIT-${tenantId.slice(0, 8)}`]
    );
    await pool.query(`INSERT INTO branches (id, tenant_id, name, address) VALUES ($1, $2, 'Sede', 'Calle 1')`, [
      branchId,
      tenantId
    ]);
    await pool.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, 'x', 'Admin', 'ADMIN')`,
      [userId, tenantId, `num.${tenantId.slice(0, 8)}@test.local`]
    );
    await pool.query(
      `INSERT INTO terminals (id, tenant_id, branch_id, name) VALUES ($1, $2, $3, 'Caja')`,
      [terminalId, tenantId, branchId]
    );
    await pool.query(
      `INSERT INTO cash_sessions (id, tenant_id, branch_id, terminal_id, opened_by_user_id, opening_amount_cents, status)
       VALUES ($1, $2, $3, $4, $5, 0, 'OPEN')`,
      [cashSessionId, tenantId, branchId, terminalId, userId]
    );
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM dian_documents WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM sales WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM dian_resolutions WHERE tenant_id = $1`, [tenantId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM dian_documents WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM sales WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM dian_resolutions WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM cash_sessions WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM terminals WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM branches WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await pool.end();
  });

  it('entrega los números en orden, empezando por el primero del rango', async () => {
    await createResolution({ prefix: 'SETP', rangeFrom: 5000, rangeTo: 5010 });

    const first = await assignDocumentNumber(pool, {
      tenantId,
      branchId,
      documentId: await createDocument(),
      documentType: 'INVOICE'
    });
    const second = await assignDocumentNumber(pool, {
      tenantId,
      branchId,
      documentId: await createDocument(),
      documentType: 'INVOICE'
    });

    expect(first.prefix).toBe('SETP');
    expect(first.documentNumber).toBe(5000);
    expect(second.documentNumber).toBe(5001);
    expect(second.remaining).toBe(9);
  });

  it('un reintento reutiliza el número en vez de quemar otro', async () => {
    await createResolution({ rangeFrom: 100, rangeTo: 200 });
    const documentId = await createDocument();

    const firstTry = await assignDocumentNumber(pool, { tenantId, branchId, documentId, documentType: 'INVOICE' });
    const retry = await assignDocumentNumber(pool, { tenantId, branchId, documentId, documentType: 'INVOICE' });

    expect(retry.documentNumber).toBe(firstTry.documentNumber);
    expect(retry.reused).toBe(true);

    // Y el consecutivo de la resolución no avanzó dos veces.
    const { rows } = await pool.query<{ current_number: string }>(
      `SELECT current_number FROM dian_resolutions WHERE tenant_id = $1`,
      [tenantId]
    );
    expect(Number(rows[0]!.current_number)).toBe(firstTry.documentNumber);
  });

  it('dos workers concurrentes no obtienen el mismo número', async () => {
    // Es el escenario que importa de verdad: dos réplicas del worker procesando la bandeja
    // de salida a la vez. El `UPDATE ... RETURNING` toma un lock de fila, así que se
    // serializan solas; si alguien lo cambiara por un SELECT y luego un UPDATE, esta prueba
    // fallaría con números repetidos.
    await createResolution({ prefix: 'CON', rangeFrom: 700, rangeTo: 799 });

    const documentIds = await Promise.all(Array.from({ length: 12 }, () => createDocument()));

    const assigned = await Promise.all(
      documentIds.map(async (documentId) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await assignDocumentNumber(client, {
            tenantId,
            branchId,
            documentId,
            documentType: 'INVOICE'
          });
          await client.query('COMMIT');
          return result.documentNumber;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      })
    );

    const unique = new Set(assigned);
    expect(unique.size, `números repetidos: ${assigned.join(', ')}`).toBe(assigned.length);

    // Y son consecutivos, sin huecos.
    const sorted = [...assigned].sort((a, b) => a - b);
    expect(sorted[0]).toBe(700);
    expect(sorted[sorted.length - 1]).toBe(711);
  });

  it('si la emisión falla después de reservar, el número vuelve al rango', async () => {
    // Un hueco en la numeración hay que justificarlo ante la DIAN. El rollback tiene que
    // devolver el consecutivo, no dejarlo consumido como haría una secuencia de Postgres.
    await createResolution({ rangeFrom: 300, rangeTo: 400 });
    const documentId = await createDocument();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assignDocumentNumber(client, { tenantId, branchId, documentId, documentType: 'INVOICE' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const next = await assignDocumentNumber(pool, {
      tenantId,
      branchId,
      documentId: await createDocument(),
      documentType: 'INVOICE'
    });

    expect(next.documentNumber).toBe(300);
  });

  it('avisa cuando quedan pocos números', async () => {
    await createResolution({ rangeFrom: 1, rangeTo: 10, alertThreshold: 5 });

    const early = await assignDocumentNumber(pool, {
      tenantId,
      branchId,
      documentId: await createDocument(),
      documentType: 'INVOICE'
    });
    expect(early.belowThreshold).toBe(false);

    for (let i = 0; i < 5; i += 1) {
      await assignDocumentNumber(pool, {
        tenantId,
        branchId,
        documentId: await createDocument(),
        documentType: 'INVOICE'
      });
    }

    const late = await assignDocumentNumber(pool, {
      tenantId,
      branchId,
      documentId: await createDocument(),
      documentType: 'INVOICE'
    });
    expect(late.belowThreshold).toBe(true);
  });

  it('se niega a emitir cuando el rango se agota, y dice qué hacer', async () => {
    await createResolution({ prefix: 'FIN', rangeFrom: 1, rangeTo: 2 });

    await assignDocumentNumber(pool, {
      tenantId,
      branchId,
      documentId: await createDocument(),
      documentType: 'INVOICE'
    });
    await assignDocumentNumber(pool, {
      tenantId,
      branchId,
      documentId: await createDocument(),
      documentType: 'INVOICE'
    });

    const third = assignDocumentNumber(pool, {
      tenantId,
      branchId,
      documentId: await createDocument(),
      documentType: 'INVOICE'
    });

    await expect(third).rejects.toThrow(FiscalNumberingError);
    await expect(third).rejects.toThrow(/agotó su rango/i);
  });

  it('se niega a emitir con la resolución vencida', async () => {
    await createResolution({
      prefix: 'OLD',
      validFrom: isoDaysFromNow(-400),
      validUntil: isoDaysFromNow(-1)
    });

    const attempt = assignDocumentNumber(pool, {
      tenantId,
      branchId,
      documentId: await createDocument(),
      documentType: 'INVOICE'
    });

    await expect(attempt).rejects.toThrow(/venció/i);
  });

  it('se niega a emitir cuando no hay ninguna resolución cargada', async () => {
    const attempt = assignDocumentNumber(pool, {
      tenantId,
      branchId,
      documentId: await createDocument(),
      documentType: 'INVOICE'
    });

    await expect(attempt).rejects.toThrow(/no tiene una resolución de facturación activa/i);
  });
});
