import type { Job } from 'bullmq';
import type { Pool } from 'pg';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DianProvider,
  DianProviderEmitSaleInput,
  DianProviderEmitSaleResult
} from '@pos-dian/shared/types/dian-provider.js';
import { buildOutboxSaleVoidedProcessor } from '../src/jobs/outbox-sale-voided.processor.js';
import type { OutboxSaleVoidedJobData } from '../src/jobs/types.js';

interface QueryResultLike<T = unknown> {
  rows: T[];
}

function createJob(outboxEventId: string): Job<OutboxSaleVoidedJobData> {
  return {
    data: { outboxEventId },
    log: vi.fn().mockResolvedValue(undefined)
  } as unknown as Job<OutboxSaleVoidedJobData>;
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

afterEach(() => {
  consoleInfoSpy.mockClear();
  consoleErrorSpy.mockClear();
});

afterAll(() => {
  consoleInfoSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe('outbox sale voided processor', () => {
  it('emits a CREDIT_NOTE using a separate dian document', async () => {
    const provider: DianProvider = {
      emitSale: vi.fn(async () => ({
        status: 'ACCEPTED' as const,
        cude: 'CUDE-CN-1',
        raw: { provider: 'mock', document_type: 'CREDIT_NOTE' }
      }))
    };

    const creditNoteInserts: unknown[][] = [];
    const dianDocumentUpdates: unknown[][] = [];
    const outboxSentUpdates: unknown[][] = [];

    const pool = createPoolMock(async (queryText, params = []) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: 'outbox-voided',
              tenant_id: 'tenant-voided',
              aggregate_id: 'sale-voided',
              status: 'PENDING',
              attempts: 0,
              payload_json: { idempotency_key: 'void-idem-1', sale_id: 'sale-voided', tenant_id: 'tenant-voided', branch_id: 'branch-voided' }
            }
          ]
        };
      }

      if (
        queryText.includes('SELECT id, status, cude') &&
        queryText.includes('FROM dian_documents') &&
        queryText.includes("document_type = 'INVOICE'")
      ) {
        return {
          rows: [
            {
              id: 'invoice-doc-1',
              status: 'ACCEPTED',
              cude: 'CUDE-FE-1'
            }
          ]
        };
      }

      if (
        queryText.includes('SELECT id, status, cude') &&
        queryText.includes('FROM dian_documents') &&
        queryText.includes("document_type = 'CREDIT_NOTE'")
      ) {
        return { rows: [] };
      }

      if (queryText.includes('INSERT INTO dian_documents')) {
        creditNoteInserts.push(params);
        return {
          rows: [
            {
              id: 'credit-note-doc-1',
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
              sale_id: 'sale-voided',
              sale_number: '42',
              created_at: new Date('2026-05-01T13:00:00.000Z'),
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
              tenant_id: 'tenant-voided',
              tenant_name: 'Tenant Voided',
              tenant_nit: '900000042',
              tenant_business_name: 'Tenant Voided SAS',
              branch_id: 'branch-voided',
              branch_name: 'Sucursal Centro',
              branch_address: 'Cra 1 # 2-3',
              void_reason: 'Error de digitación'
            }
          ]
        };
      }

      if (queryText.includes('FROM sale_items si') && queryText.includes('INNER JOIN products p')) {
        return {
          rows: [
            {
              id: 'item-voided',
              product_id: 'product-voided',
              qty: '1.000',
              price_cents: 11900,
              line_total_cents: 11900,
              product_name: 'Producto facturado',
              barcode: null,
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

    const processor = buildOutboxSaleVoidedProcessor({ pool, provider });
    const job = createJob('outbox-voided');

    await processor(job);

    expect(creditNoteInserts).toHaveLength(1);
    expect(creditNoteInserts[0]?.[1]).toBe('tenant-voided');
    expect(creditNoteInserts[0]?.[2]).toBe('sale-voided');
    expect(creditNoteInserts[0]?.[3]).toBe('invoice-doc-1');

    expect(provider.emitSale).toHaveBeenCalledOnce();
    const providerPayload = (provider.emitSale as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | DianProviderEmitSaleInput
      | undefined;

    expect(providerPayload).toMatchObject({
      sale_id: 'sale-voided',
      tenant_id: 'tenant-voided',
      branch_id: 'branch-voided',
      document_type: 'CREDIT_NOTE',
      void_reason: 'Error de digitación',
      idempotency_key: 'void-idem-1'
    });

    expect(dianDocumentUpdates).toHaveLength(1);
    const [updatedDocumentId, providerPayloadJson, , finalStatus, cude] = dianDocumentUpdates[0]!;
    expect(updatedDocumentId).toBe('credit-note-doc-1');
    expect(finalStatus).toBe('ACCEPTED');
    expect(cude).toBe('CUDE-CN-1');
    expect(JSON.parse(providerPayloadJson as string)).toMatchObject({
      document_type: 'CREDIT_NOTE',
      void_reason: 'Error de digitación'
    });

    expect(outboxSentUpdates[0]).toEqual(['outbox-voided', 1]);
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      'credit_note_document=credit-note-doc-1'
    );
  });

  it('retries when the invoice document is not ACCEPTED yet', async () => {
    const provider: DianProvider = {
      emitSale: vi.fn<
        (input: DianProviderEmitSaleInput) => Promise<DianProviderEmitSaleResult>
      >()
    };

    const outboxFailedUpdates: unknown[][] = [];

    const pool = createPoolMock(async (queryText, params = []) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: 'outbox-waiting',
              tenant_id: 'tenant-waiting',
              aggregate_id: 'sale-waiting',
              status: 'PENDING',
              attempts: 1,
              payload_json: { sale_id: 'sale-waiting', tenant_id: 'tenant-waiting', branch_id: 'branch-waiting' }
            }
          ]
        };
      }

      if (
        queryText.includes('SELECT id, status, cude') &&
        queryText.includes('FROM dian_documents') &&
        queryText.includes("document_type = 'INVOICE'")
      ) {
        return {
          rows: [
            {
              id: 'invoice-doc-waiting',
              status: 'SENT',
              cude: null
            }
          ]
        };
      }

      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'FAILED'")) {
        outboxFailedUpdates.push(params);
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const processor = buildOutboxSaleVoidedProcessor({ pool, provider });
    const job = createJob('outbox-waiting');

    await expect(processor(job)).rejects.toThrow('Dian invoice document not yet ACCEPTED');

    expect(provider.emitSale).not.toHaveBeenCalled();
    expect(outboxFailedUpdates).toHaveLength(1);
    expect(outboxFailedUpdates[0]?.[0]).toBe('outbox-waiting');
    expect(outboxFailedUpdates[0]?.[1]).toBe(2);
    expect(outboxFailedUpdates[0]?.[2]).toBeInstanceOf(Date);
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      'invoice_document=invoice-doc-waiting'
    );
  });
});
