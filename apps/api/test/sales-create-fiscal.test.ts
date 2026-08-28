import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  adminDb,
  closeAdminDb,
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

/**
 * Persistencia fiscal de la venta.
 *
 * Estas pruebas corrían contra un doble de Kysely escrito a mano (~430 líneas) que no
 * soportaba SQL crudo, así que dejaron de ejecutarse en cuanto `createSaleService`
 * empezó a fijar el contexto RLS con `set_config`. Un doble de la base de datos solo
 * puede confirmar lo que ya creemos; el impuesto que se declara ante la DIAN merece
 * verificarse contra Postgres real.
 */

interface TestContext {
  fixture: E2eFixture;
  token: string;
  cashSessionId: string;
}

let app: FastifyInstance;
const createdTenants: Array<Pick<E2eFixture, 'tenantId'>> = [];

async function setup(
  taxMode: 'IVA' | 'INC_RESTAURANT',
  productTaxCategory: 'IVA_19' | 'INC_8',
  productPriceCents: number
): Promise<TestContext> {
  const fixture = await seedE2eFixture(app, { taxMode, productTaxCategory, productPriceCents });
  createdTenants.push({ tenantId: fixture.tenantId });

  const token = await loginE2eUser(app, {
    email: fixture.adminEmail,
    password: fixture.adminPassword
  });

  const openRes = await app.inject({
    method: 'POST',
    url: '/api/v1/cash-sessions/open',
    headers: bearerHeaders(token),
    payload: {
      branch_id: fixture.branchId,
      terminal_id: fixture.terminalId,
      opening_amount_cents: 10000
    }
  });
  expect(openRes.statusCode).toBe(201);

  const cashSessionId = (openRes.json() as { cash_session: { id: string } }).cash_session.id;
  return { fixture, token, cashSessionId };
}

function salePayload(ctx: TestContext, overrides: Record<string, unknown> = {}) {
  return {
    client_uuid: randomUUID(),
    branch_id: ctx.fixture.branchId,
    cash_session_id: ctx.cashSessionId,
    items: [{ product_id: ctx.fixture.productId, qty: 1 }],
    discount_cents: 0,
    tip_cents: 0,
    payments: [{ method: 'CASH', amount_cents: ctx.fixture.productPriceCents }],
    ...overrides
  };
}

async function postSale(ctx: TestContext, overrides: Record<string, unknown> = {}) {
  return await app.inject({
    method: 'POST',
    url: '/api/v1/sales',
    headers: bearerHeaders(ctx.token),
    payload: salePayload(ctx, overrides)
  });
}

async function readPersistedSale(tenantId: string, saleId: string) {
  return await adminDb()
    .selectFrom('sales')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', saleId)
    .executeTakeFirstOrThrow();
}

describe('POST /sales — persistencia fiscal', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    while (createdTenants.length > 0) {
      await cleanupE2eFixture(app, createdTenants.pop()!);
    }
  });

  afterAll(async () => {
    await closeAdminDb();
    await app.close();
  });

  it('persiste las líneas de IVA_19 y el tax_total_cents', async () => {
    const ctx = await setup('IVA', 'IVA_19', 11900);

    const response = await postSale(ctx);
    expect(response.statusCode).toBe(201);

    const body = response.json() as {
      sale: {
        id: string;
        subtotal_cents: number;
        discount_cents: number;
        total_cents: number;
        tax_total_cents: number;
        tax_lines_json: Array<Record<string, unknown>>;
      };
    };

    expect(body.sale.tax_total_cents).toBe(1900);
    expect(body.sale.tax_lines_json).toEqual([
      { line_index: 0, category: 'IVA_19', base_cents: 10000, tax_cents: 1900, rate: 0.19 }
    ]);
    // En régimen de IVA el impuesto va incluido en el precio: el total no lo suma aparte.
    expect(body.sale.total_cents).toBe(body.sale.subtotal_cents - body.sale.discount_cents);

    const persisted = await readPersistedSale(ctx.fixture.tenantId, body.sale.id);
    expect(persisted.tax_total_cents).toBe(1900);
    expect(persisted.tax_lines_json).toEqual(body.sale.tax_lines_json);
    expect(persisted.total_cents).toBe(persisted.subtotal_cents - persisted.discount_cents);

    // El documento DIAN lo emite el worker: aquí solo debe quedar el evento pendiente.
    const outbox = await adminDb()
      .selectFrom('outbox_events')
      .select(['type', 'status', 'aggregate_id'])
      .where('tenant_id', '=', ctx.fixture.tenantId)
      .where('aggregate_id', '=', body.sale.id)
      .executeTakeFirstOrThrow();

    expect(outbox).toMatchObject({
      type: 'sale.created',
      status: 'PENDING',
      aggregate_id: body.sale.id
    });
  });

  it('persiste las líneas de INC_RESTAURANT sin alterar la fórmula del total', async () => {
    const ctx = await setup('INC_RESTAURANT', 'INC_8', 10800);

    const response = await postSale(ctx);
    expect(response.statusCode).toBe(201);

    const body = response.json() as {
      sale: {
        id: string;
        subtotal_cents: number;
        discount_cents: number;
        total_cents: number;
        tax_total_cents: number;
        tax_lines_json: Array<Record<string, unknown>>;
      };
    };

    expect(body.sale.tax_total_cents).toBe(800);
    expect(body.sale.tax_lines_json).toEqual([
      { line_index: 0, category: 'INC', base_cents: 10000, tax_cents: 800, rate: 0.08 }
    ]);
    expect(body.sale.total_cents).toBe(body.sale.subtotal_cents - body.sale.discount_cents);

    const persisted = await readPersistedSale(ctx.fixture.tenantId, body.sale.id);
    expect(persisted.tax_total_cents).toBe(800);
    expect(persisted.tax_lines_json).toEqual(body.sale.tax_lines_json);
  });

  it('ignora el tax_category que envía el cliente y usa el del producto en base de datos', async () => {
    const ctx = await setup('IVA', 'IVA_19', 11900);

    // El cliente intenta declarar el producto como excluido de IVA.
    const response = await postSale(ctx, {
      items: [{ product_id: ctx.fixture.productId, qty: 1, tax_category: 'EXCLUDED' }]
    });
    expect(response.statusCode).toBe(201);

    const body = response.json() as {
      sale: { id: string; tax_total_cents: number; tax_lines_json: Array<{ category: string }> };
    };

    expect(body.sale.tax_total_cents).toBe(1900);
    expect(body.sale.tax_lines_json[0]?.category).toBe('IVA_19');

    const persisted = await readPersistedSale(ctx.fixture.tenantId, body.sale.id);
    expect(persisted.tax_total_cents).toBe(1900);
  });

  it('asigna consecutivos distintos cuando dos ventas se crean en paralelo', async () => {
    const ctx = await setup('IVA', 'IVA_19', 11900);

    // Es la carrera real que el reintento por colisión de sale_number existe para cubrir.
    const [first, second] = await Promise.all([postSale(ctx), postSale(ctx)]);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const numbers = [first, second]
      .map((r) => (r.json() as { sale: { sale_number: number } }).sale.sale_number)
      .sort((a, b) => a - b);

    expect(numbers).toEqual([1, 2]);

    const rows = await adminDb()
      .selectFrom('sales')
      .select(['id'])
      .where('tenant_id', '=', ctx.fixture.tenantId)
      .execute();
    expect(rows).toHaveLength(2);
  });

  it('devuelve la venta existente para el mismo client_uuid sin duplicar registros', async () => {
    const ctx = await setup('IVA', 'IVA_19', 11900);
    const clientUuid = randomUUID();

    const first = await postSale(ctx, { client_uuid: clientUuid });
    expect(first.statusCode).toBe(201);
    const firstSaleId = (first.json() as { sale: { id: string } }).sale.id;

    const second = await postSale(ctx, { client_uuid: clientUuid });
    expect([200, 201]).toContain(second.statusCode);
    const secondSaleId = (second.json() as { sale: { id: string } }).sale.id;

    expect(secondSaleId).toBe(firstSaleId);

    const sales = await adminDb()
      .selectFrom('sales')
      .select(['id'])
      .where('tenant_id', '=', ctx.fixture.tenantId)
      .execute();
    expect(sales).toHaveLength(1);

    const items = await adminDb()
      .selectFrom('sale_items')
      .select(['id'])
      .where('tenant_id', '=', ctx.fixture.tenantId)
      .execute();
    expect(items).toHaveLength(1);
  });

  it('ignora el impuesto que declara el cliente en el snapshot', async () => {
    const ctx = await setup('IVA', 'IVA_19', 11900);

    // Un cliente manipulado declara casi nada de impuesto. El servidor factura su propio
    // cálculo y deja rastro de la discrepancia.
    const response = await postSale(ctx, {
      snapshot: {
        subtotal_cents: 11900,
        discount_cents: 0,
        tip_cents: 0,
        tax_total_cents: 1,
        total_cents: 11900
      }
    });
    expect(response.statusCode).toBe(201);

    const body = response.json() as { sale: { id: string; tax_total_cents: number; total_cents: number } };
    expect(body.sale.tax_total_cents).toBe(1900);
    expect(body.sale.total_cents).toBe(11900);

    const persisted = await readPersistedSale(ctx.fixture.tenantId, body.sale.id);
    expect(persisted.tax_total_cents).toBe(1900);

    const outbox = await adminDb()
      .selectFrom('outbox_events')
      .select(['payload_json'])
      .where('tenant_id', '=', ctx.fixture.tenantId)
      .where('aggregate_id', '=', body.sale.id)
      .where('type', '=', 'sale.created')
      .executeTakeFirstOrThrow();

    const auditPayload = (outbox.payload_json as { audit_payload?: Record<string, unknown> }).audit_payload;
    expect(auditPayload?.snapshot_discrepancy).toMatchObject({
      client: { tax_total_cents: 1 },
      server: { tax_total_cents: 1900 }
    });
  });

  it('rechaza una venta offline cuyo precio se desvía más del 10% del catálogo actual', async () => {
    const ctx = await setup('IVA', 'IVA_19', 11900);

    const response = await postSale(ctx, {
      items: [{ product_id: ctx.fixture.productId, qty: 1, price_cents: 5000 }],
      payments: [{ method: 'CASH', amount_cents: 5000 }],
      snapshot: {
        subtotal_cents: 5000,
        discount_cents: 0,
        tip_cents: 0,
        tax_total_cents: 0,
        total_cents: 5000
      }
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('PRICE_DRIFT_EXCEEDED');
  });

  it('solo registra en el libro de caja el componente en efectivo', async () => {
    const ctx = await setup('IVA', 'IVA_19', 11900);

    // Venta con tarjeta: no entra un peso al cajón.
    const cardSale = await postSale(ctx, {
      payments: [{ method: 'CARD', amount_cents: 11900, approval_code: '123456' }]
    });
    expect(cardSale.statusCode).toBe(201);

    const afterCard = await adminDb()
      .selectFrom('cash_ledger')
      .select(['type', 'amount_cents'])
      .where('tenant_id', '=', ctx.fixture.tenantId)
      .where('type', '=', 'CASH_SALE')
      .execute();
    expect(afterCard).toHaveLength(0);

    // Venta mixta: solo la parte en efectivo.
    const mixedSale = await postSale(ctx, {
      payments: [
        {
          method: 'MIXED',
          payments: [
            { method: 'CASH', amount_cents: 4000 },
            { method: 'CARD', amount_cents: 7900, approval_code: '654321' }
          ]
        }
      ]
    });
    expect(mixedSale.statusCode).toBe(201);

    const afterMixed = await adminDb()
      .selectFrom('cash_ledger')
      .select(['type', 'amount_cents'])
      .where('tenant_id', '=', ctx.fixture.tenantId)
      .where('type', '=', 'CASH_SALE')
      .execute();

    expect(afterMixed).toHaveLength(1);
    // bigint vuelve como string desde pg
    expect(Number(afterMixed[0]!.amount_cents)).toBe(4000);
  });

  it('persiste los metadatos de anulación, emite el evento y rechaza una segunda anulación', async () => {
    const ctx = await setup('IVA', 'IVA_19', 11900);

    const created = await postSale(ctx);
    expect(created.statusCode).toBe(201);
    const saleId = (created.json() as { sale: { id: string } }).sale.id;

    const voidRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/void`,
      headers: bearerHeaders(ctx.token),
      payload: { void_reason: 'Cobro duplicado' }
    });
    expect(voidRes.statusCode).toBe(200);

    const persisted = await readPersistedSale(ctx.fixture.tenantId, saleId);
    expect(persisted.status).toBe('VOID');
    expect(persisted.void_reason).toBe('Cobro duplicado');
    expect(persisted.voided_by_user_id).toBe(ctx.fixture.adminUserId);
    expect(persisted.voided_at).not.toBeNull();

    // La anulación siempre publica su evento, incluso si la factura aún no salió:
    // el worker decide si corresponde nota crédito o si no hay nada que anular.
    const voidedEvent = await adminDb()
      .selectFrom('outbox_events')
      .select(['type', 'status'])
      .where('tenant_id', '=', ctx.fixture.tenantId)
      .where('aggregate_id', '=', saleId)
      .where('type', '=', 'sale.voided')
      .executeTakeFirst();

    expect(voidedEvent).toMatchObject({ type: 'sale.voided', status: 'PENDING' });

    const secondVoid = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/void`,
      headers: bearerHeaders(ctx.token),
      payload: { void_reason: 'Otro intento' }
    });
    expect(secondVoid.statusCode).toBe(409);
  });
});
