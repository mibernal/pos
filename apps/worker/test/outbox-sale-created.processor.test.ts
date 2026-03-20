import type { Job } from 'bullmq';
import type { Pool } from 'pg';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DianProvider,
  DianProviderEmitSaleInput,
  DianProviderEmitSaleResult
} from '@pos-dian/shared/types/dian-provider.js';
import { buildOutboxSaleCreatedProcessor } from '../src/jobs/outbox-sale-created.processor.js';
import type { OutboxSaleCreatedJobData } from '../src/jobs/types.js';
import { DianProviderMock } from '../src/providers/dian-provider-mock.js';

interface QueryResultLike<T = unknown> {
  rows: T[];
}

function createJob(outboxEventId: string): Job<OutboxSaleCreatedJobData> {
  return {
    data: { outboxEventId },
    log: vi.fn().mockResolvedValue(undefined)
  } as unknown as Job<OutboxSaleCreatedJobData>;
}

function createPoolMock(
  implementation: (queryText: string, params?: unknown[]) => Promise<QueryResultLike>
): Pool {
  return {
    query: vi.fn((queryText: string, params?: unknown[]) => implementation(queryText, params))
  } as unknown as Pool;
}

const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

function parseStructuredLogs(spy: typeof consoleInfoSpy | typeof consoleErrorSpy) {
  return spy.mock.calls
    .map(([line]) => {
      if (typeof line !== 'string') {
        return null;
      }

      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((value): value is Record<string, unknown> => value !== null);
}

afterEach(() => {
  consoleInfoSpy.mockClear();
  consoleErrorSpy.mockClear();
});

afterAll(() => {
  consoleInfoSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe('outbox sale created processor', () => {
  it('does not re-emit when dian document is ACCEPTED even without CUDE', async () => {
    const pool = createPoolMock(async (queryText) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: 'outbox-1',
              tenant_id: 'tenant-1',
              aggregate_id: 'sale-1',
              status: 'PENDING',
              attempts: 2,
              payload_json: { idempotency_key: 'idem-1' }
            }
          ]
        };
      }

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return {
          rows: [
            {
              id: 'doc-1',
              status: 'ACCEPTED',
              cude: null
            }
          ]
        };
      }

      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const provider: DianProvider = {
      emitSale: vi.fn<
        (input: DianProviderEmitSaleInput) => Promise<DianProviderEmitSaleResult>
      >()
    };

    const processor = buildOutboxSaleCreatedProcessor({ pool, provider });
    const job = createJob('outbox-1');

    await processor(job);

    expect(provider.emitSale).not.toHaveBeenCalled();
    expect(job.log).toHaveBeenCalledOnce();
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('reason=document already accepted');
    expect(parseStructuredLogs(consoleInfoSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'dian_outbox_job_skipped',
          outbox_event_id: 'outbox-1',
          sale_id: 'sale-1',
          tenant_id: 'tenant-1',
          attempt: 3,
          provider_result: 'SKIPPED',
          reason: 'document already accepted'
        })
      ])
    );
  });

  it('builds provider payload from persisted fiscal data and product tax category', async () => {
    const provider: DianProvider = {
      emitSale: vi.fn(async () => ({
        status: 'ACCEPTED' as const,
        cude: 'CUDE-123',
        raw: { provider: 'mock' }
      }))
    };

    const pool = createPoolMock(async (queryText) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: 'outbox-2',
              tenant_id: 'tenant-2',
              aggregate_id: 'sale-2',
              status: 'PENDING',
              attempts: 0,
              payload_json: { idempotency_key: 'idem-2' }
            }
          ]
        };
      }

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return {
          rows: [
            {
              id: 'doc-2',
              status: 'PENDING',
              cude: null
            }
          ]
        };
      }

      if (queryText.includes('FROM sales s') && queryText.includes('INNER JOIN tenants t')) {
        return {
          rows: [
            {
              sale_id: 'sale-2',
              sale_number: '27',
              created_at: new Date('2026-03-05T12:00:00.000Z'),
              subtotal_cents: 10800,
              discount_cents: 0,
              total_cents: 10800,
              tax_total_cents: 800,
              tax_lines_json: [
                {
                  line_index: 0,
                  category: 'INC',
                  base_cents: 10000,
                  tax_cents: 800,
                  rate: 0.08
                }
              ],
              payment_json: {
                mode: 'CASH',
                total_cents: 10800,
                payments: [{ method: 'CASH', amount_cents: 10800 }]
              },
              tax_mode: 'INC_RESTAURANT',
              tenant_id: 'tenant-2',
              tenant_name: 'Tenant 2',
              tenant_nit: '900000002',
              tenant_business_name: 'Tenant 2 SAS',
              branch_id: 'branch-2',
              branch_name: 'Sucursal Norte',
              branch_address: 'Cra 7 # 12-34'
            }
          ]
        };
      }

      if (queryText.includes('FROM sale_items si') && queryText.includes('INNER JOIN products p')) {
        return {
          rows: [
            {
              id: 'item-1',
              product_id: 'product-1',
              qty: '1.000',
              price_cents: 10800,
              line_total_cents: 10800,
              product_name: 'Almuerzo',
              barcode: null,
              tax_category: 'INC_8'
            }
          ]
        };
      }

      if (queryText.includes('UPDATE dian_documents') && queryText.includes('provider_payload_json')) {
        return { rows: [] };
      }

      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const processor = buildOutboxSaleCreatedProcessor({ pool, provider });
    await processor(createJob('outbox-2'));

    expect(provider.emitSale).toHaveBeenCalledOnce();

    const payload = (provider.emitSale as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | DianProviderEmitSaleInput
      | undefined;

    expect(payload).toBeDefined();
    expect(payload?.taxMode).toBe('INC_RESTAURANT');
    expect(payload?.sale.tax_total_cents).toBe(800);
    expect(payload?.sale.tax_lines).toEqual([
      {
        lineIndex: 0,
        category: 'INC',
        base_cents: 10000,
        tax_cents: 800,
        rate: 0.08
      }
    ]);
    expect(payload?.sale.items).toEqual([
      {
        id: 'item-1',
        product_id: 'product-1',
        product_name: 'Almuerzo',
        barcode: null,
        tax_category: 'INC_8',
        category: 'INC',
        base_cents: 10000,
        tax_cents: 800,
        rate: 0.08,
        qty: 1,
        price_cents: 10800,
        line_total_cents: 10800
      }
    ]);
  });

  it('processes a pending dian document through ACCEPTED and marks the outbox as sent', async () => {
    const provider = new DianProviderMock();
    const dianDocumentUpdates: unknown[][] = [];
    const outboxSentUpdates: unknown[][] = [];

    const pool = createPoolMock(async (queryText, params = []) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: 'outbox-accepted',
              tenant_id: 'tenant-accepted',
              aggregate_id: 'sale-accepted',
              status: 'PENDING',
              attempts: 0,
              payload_json: { idempotency_key: 'idem-accepted' }
            }
          ]
        };
      }

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return {
          rows: [
            {
              id: 'doc-accepted',
              status: 'PENDING',
              cude: null
            }
          ]
        };
      }

      if (queryText.includes('FROM sales s') && queryText.includes('INNER JOIN tenants t')) {
        return {
          rows: [
            {
              sale_id: 'sale-accepted',
              sale_number: '101',
              created_at: new Date('2026-03-07T10:00:00.000Z'),
              subtotal_cents: 10000,
              discount_cents: 0,
              total_cents: 11900,
              tax_total_cents: 1900,
              tax_lines_json: [
                {
                  line_index: 0,
                  category: 'IVA_19',
                  base_cents: 10000,
                  tax_cents: 1900,
                  rate: 0.19
                }
              ],
              payment_json: {
                mode: 'CARD',
                total_cents: 11900,
                payments: [{ method: 'CARD', amount_cents: 11900 }]
              },
              tax_mode: 'IVA',
              tenant_id: 'tenant-accepted',
              tenant_name: 'Tenant Accepted',
              tenant_nit: '900000101',
              tenant_business_name: 'Tenant Accepted SAS',
              branch_id: 'branch-accepted',
              branch_name: 'Sucursal Centro',
              branch_address: 'Cra 10 # 20-30'
            }
          ]
        };
      }

      if (queryText.includes('FROM sale_items si') && queryText.includes('INNER JOIN products p')) {
        return {
          rows: [
            {
              id: 'item-accepted',
              product_id: 'product-accepted',
              qty: '1.000',
              price_cents: 11900,
              line_total_cents: 11900,
              product_name: 'Combo Ejecutivo',
              barcode: '7701001001001',
              tax_category: 'IVA_19'
            }
          ]
        };
      }

      if (queryText.includes('UPDATE dian_documents') && queryText.includes('provider_payload_json')) {
        dianDocumentUpdates.push(params);
        return { rows: [] };
      }

      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        outboxSentUpdates.push(params);
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const processor = buildOutboxSaleCreatedProcessor({ pool, provider });
    const job = createJob('outbox-accepted');

    await processor(job);

    expect(dianDocumentUpdates).toHaveLength(1);
    expect(outboxSentUpdates).toHaveLength(1);

    const [dianDocumentId, providerPayloadJson, providerResponseJson, finalStatus, cude] =
      dianDocumentUpdates[0]!;

    expect(dianDocumentId).toBe('doc-accepted');
    expect(finalStatus).toBe('ACCEPTED');
    expect(cude).toMatch(/^CUDE-/);
    expect(JSON.parse(providerPayloadJson as string)).toMatchObject({
      sale_id: 'sale-accepted',
      taxMode: 'IVA',
      sale: {
        tax_total_cents: 1900,
        tax_lines: [
          {
            lineIndex: 0,
            category: 'IVA_19',
            base_cents: 10000,
            tax_cents: 1900,
            rate: 0.19
          }
        ]
      }
    });
    expect(JSON.parse(providerResponseJson as string)).toMatchObject({
      provider: 'mock',
      taxMode: 'IVA',
      tax_total_cents: 1900
    });

    expect(outboxSentUpdates[0]).toEqual(['outbox-accepted', 1]);
    expect(job.log).toHaveBeenCalledOnce();
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      'transitions=PENDING->SENT, SENT->ACCEPTED'
    );
    expect(parseStructuredLogs(consoleInfoSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'dian_outbox_job_started',
          outbox_event_id: 'outbox-accepted',
          sale_id: 'sale-accepted',
          tenant_id: 'tenant-accepted',
          attempt: 1
        }),
        expect.objectContaining({
          event: 'dian_outbox_job_succeeded',
          outbox_event_id: 'outbox-accepted',
          sale_id: 'sale-accepted',
          tenant_id: 'tenant-accepted',
          attempt: 1,
          dian_transition: 'PENDING->SENT, SENT->ACCEPTED',
          provider_result: 'ACCEPTED'
        })
      ])
    );
  });

  it('does not re-emit when dian document is already SENT', async () => {
    const pool = createPoolMock(async (queryText) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: 'outbox-3',
              tenant_id: 'tenant-3',
              aggregate_id: 'sale-3',
              status: 'FAILED',
              attempts: 1,
              payload_json: { idempotency_key: 'idem-3' }
            }
          ]
        };
      }

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return {
          rows: [
            {
              id: 'doc-3',
              status: 'SENT',
              cude: null
            }
          ]
        };
      }

      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const provider: DianProvider = {
      emitSale: vi.fn<
        (input: DianProviderEmitSaleInput) => Promise<DianProviderEmitSaleResult>
      >()
    };

    const processor = buildOutboxSaleCreatedProcessor({ pool, provider });
    const job = createJob('outbox-3');

    await processor(job);

    expect(provider.emitSale).not.toHaveBeenCalled();
    expect(job.log).toHaveBeenCalledOnce();
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('reason=document already emitted');
  });

  it('marks the outbox as processed when provider rejects the document', async () => {
    const provider: DianProvider = {
      emitSale: vi.fn(async () => ({
        status: 'REJECTED' as const,
        cude: null,
        raw: { provider: 'mock', reason: 'invalid xml' }
      }))
    };

    const pool = createPoolMock(async (queryText) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: 'outbox-4',
              tenant_id: 'tenant-4',
              aggregate_id: 'sale-4',
              status: 'PENDING',
              attempts: 0,
              payload_json: { idempotency_key: 'idem-4' }
            }
          ]
        };
      }

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return {
          rows: [
            {
              id: 'doc-4',
              status: 'PENDING',
              cude: null
            }
          ]
        };
      }

      if (queryText.includes('FROM sales s') && queryText.includes('INNER JOIN tenants t')) {
        return {
          rows: [
            {
              sale_id: 'sale-4',
              sale_number: '33',
              created_at: new Date('2026-03-07T12:00:00.000Z'),
              subtotal_cents: 10000,
              discount_cents: 0,
              total_cents: 10000,
              tax_total_cents: 1597,
              tax_lines_json: [],
              payment_json: {
                mode: 'CASH',
                total_cents: 10000,
                payments: [{ method: 'CASH', amount_cents: 10000 }]
              },
              tax_mode: 'IVA',
              tenant_id: 'tenant-4',
              tenant_name: 'Tenant 4',
              tenant_nit: '900000004',
              tenant_business_name: 'Tenant 4 SAS',
              branch_id: 'branch-4',
              branch_name: 'Sucursal Sur',
              branch_address: 'Calle 8 # 10-20'
            }
          ]
        };
      }

      if (queryText.includes('FROM sale_items si') && queryText.includes('INNER JOIN products p')) {
        return {
          rows: [
            {
              id: 'item-4',
              product_id: 'product-4',
              qty: '1.000',
              price_cents: 10000,
              line_total_cents: 10000,
              product_name: 'Producto Demo',
              barcode: null,
              tax_category: 'IVA_19'
            }
          ]
        };
      }

      if (queryText.includes('UPDATE dian_documents') && queryText.includes('provider_payload_json')) {
        return { rows: [] };
      }

      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        return { rows: [] };
      }

      if (queryText.includes("SET status = 'FAILED'")) {
        throw new Error(`No se esperaba reintento para rechazo terminal: ${queryText}`);
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const processor = buildOutboxSaleCreatedProcessor({ pool, provider });
    const job = createJob('outbox-4');

    await processor(job);

    expect(provider.emitSale).toHaveBeenCalledOnce();
    expect(job.log).toHaveBeenCalledOnce();
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      'transitions=PENDING->REJECTED'
    );
  });

  it('marks the outbox as failed with retry metadata when provider emit fails', async () => {
    const provider: DianProvider = {
      emitSale: vi.fn(async () => {
        throw new Error('network timeout');
      })
    };

    const dianDocumentUpdates: unknown[][] = [];
    const outboxFailedUpdates: unknown[][] = [];

    const pool = createPoolMock(async (queryText, params = []) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: 'outbox-failed',
              tenant_id: 'tenant-failed',
              aggregate_id: 'sale-failed',
              status: 'PENDING',
              attempts: 0,
              payload_json: { idempotency_key: 'idem-failed' }
            }
          ]
        };
      }

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return {
          rows: [
            {
              id: 'doc-failed',
              status: 'PENDING',
              cude: null
            }
          ]
        };
      }

      if (queryText.includes('FROM sales s') && queryText.includes('INNER JOIN tenants t')) {
        return {
          rows: [
            {
              sale_id: 'sale-failed',
              sale_number: '202',
              created_at: new Date('2026-03-07T12:30:00.000Z'),
              subtotal_cents: 9000,
              discount_cents: 0,
              total_cents: 9000,
              tax_total_cents: 0,
              tax_lines_json: [],
              payment_json: {
                mode: 'CASH',
                total_cents: 9000,
                payments: [{ method: 'CASH', amount_cents: 9000 }]
              },
              tax_mode: 'IVA',
              tenant_id: 'tenant-failed',
              tenant_name: 'Tenant Failed',
              tenant_nit: '900000202',
              tenant_business_name: 'Tenant Failed SAS',
              branch_id: 'branch-failed',
              branch_name: 'Sucursal Occidente',
              branch_address: 'Calle 20 # 30-40'
            }
          ]
        };
      }

      if (queryText.includes('FROM sale_items si') && queryText.includes('INNER JOIN products p')) {
        return {
          rows: [
            {
              id: 'item-failed',
              product_id: 'product-failed',
              qty: '1.000',
              price_cents: 9000,
              line_total_cents: 9000,
              product_name: 'Producto Fallido',
              barcode: null,
              tax_category: 'EXCLUDED'
            }
          ]
        };
      }

      if (queryText.includes('UPDATE dian_documents') && queryText.includes('provider_payload_json')) {
        dianDocumentUpdates.push(params);
        return { rows: [] };
      }

      if (queryText.includes("UPDATE outbox_events") && queryText.includes("SET status = 'FAILED'")) {
        outboxFailedUpdates.push(params);
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const processor = buildOutboxSaleCreatedProcessor({ pool, provider });
    const job = createJob('outbox-failed');

    await expect(processor(job)).rejects.toThrow('network timeout');

    expect(provider.emitSale).toHaveBeenCalledOnce();
    expect(dianDocumentUpdates).toHaveLength(1);
    expect(outboxFailedUpdates).toHaveLength(1);

    const [dianDocumentId, providerPayloadJson, providerResponseJson, status, cude] =
      dianDocumentUpdates[0]!;
    expect(dianDocumentId).toBe('doc-failed');
    expect(status).toBeNull();
    expect(cude).toBeNull();
    expect(JSON.parse(providerPayloadJson as string)).toMatchObject({
      sale_id: 'sale-failed',
      taxMode: 'IVA'
    });
    expect(JSON.parse(providerResponseJson as string)).toEqual({
      provider: 'mock',
      error: 'network timeout'
    });

    const [outboxId, attempts, nextRetryAt] = outboxFailedUpdates[0]!;
    expect(outboxId).toBe('outbox-failed');
    expect(attempts).toBe(1);
    expect(nextRetryAt).toBeInstanceOf(Date);
    expect((nextRetryAt as Date).getTime()).toBeGreaterThan(Date.now());

    expect(job.log).toHaveBeenCalledOnce();
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      'next_retry_at='
    );
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      'error=network timeout'
    );
    expect(parseStructuredLogs(consoleErrorSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'dian_outbox_job_failed',
          outbox_event_id: 'outbox-failed',
          sale_id: 'sale-failed',
          tenant_id: 'tenant-failed',
          attempt: 1,
          provider_result: 'ERROR',
          dian_transition: 'PENDING->PENDING'
        })
      ])
    );
  });
});
