import type { Job } from 'bullmq';
import type { Pool } from 'pg';
import { env } from '../config/env.js';
import { computeNextRetryAt } from '../outbox/backoff.js';
import type { DianProvider } from '@pos-dian/shared/types/dian-provider.js';
import {
  formatDianStatusTransitions,
  getDianEmissionBlockReason,
  planDianStatusTransition
} from '../domain/dian-document-status.js';
import type { OutboxSaleCreatedJobData } from './types.js';
import { logWorkerError, logWorkerInfo } from '../infra/logging/worker-log.js';
import {
  buildIdempotencyKey,
  loadProviderPayload
} from './shared/dian-payload-builder.js';
import {
  claimOutboxEvent,
  getOrCreateDianDocument,
  markOutboxFailed,
  markOutboxSent,
  updateDianDocumentMetadata
} from './shared/outbox-store.js';

interface BuildOutboxSaleCreatedProcessorInput {
  pool: Pool;
  provider: DianProvider;
}

<<<<<<< HEAD
interface OutboxEventRow {
  id: string;
  tenant_id: string;
  aggregate_id: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  payload_json: unknown;
}

interface DianDocumentRow {
  id: string;
  status: DianStatus;
  cude: string | null;
}

interface SaleHeaderRow {
  sale_id: string;
  sale_number: string;
  created_at: Date;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  tax_total_cents: number;
  tax_lines_json: unknown;
  payment_json: unknown;
  tax_mode: string;
  tenant_id: string;
  tenant_name: string;
  tenant_nit: string;
  tenant_business_name: string;
  branch_id: string;
  branch_name: string;
  branch_address: string;
}

interface SaleItemRow {
  id: string;
  product_id: string;
  qty: string;
  price_cents: number;
  line_total_cents: number;
  product_name: string;
  barcode: string | null;
  tax_category: string;
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.trunc(parsed);
    }
  }

  return null;
}

function parseSaleNumber(rawSaleNumber: string): number {
  const parsed = Number(rawSaleNumber);
  if (Number.isFinite(parsed)) {
    return Math.trunc(parsed);
  }

  return 0;
}

function normalizeTaxMode(value: unknown): DianProviderTaxMode {
  if (value === 'INC_RESTAURANT') {
    return 'INC_RESTAURANT';
  }

  return 'IVA';
}

function normalizeTaxCategory(value: unknown): DianProviderTaxCategory {
  if (
    value === 'IVA_0' ||
    value === 'IVA_5' ||
    value === 'IVA_19' ||
    value === 'EXEMPT' ||
    value === 'EXCLUDED' ||
    value === 'INC_8' ||
    value === 'INC'
  ) {
    return value;
  }

  return 'EXCLUDED';
}

function normalizeMethod(method: unknown): 'CASH' | 'CARD' | 'TRANSFER' | null {
  if (typeof method !== 'string') {
    return null;
  }

  const upper = method.toUpperCase();
  if (upper === 'CASH' || upper === 'CARD' || upper === 'TRANSFER') {
    return upper;
  }

  return null;
}

function normalizePaymentBreakdown(
  rawPaymentJson: unknown,
  fallbackTotalCents: number
): DianProviderPaymentBreakdown {
  const defaultBreakdown: DianProviderPaymentBreakdown = {
    mode: 'MIXED',
    total_cents: fallbackTotalCents,
    amounts: {
      cash_cents: 0,
      card_cents: 0,
      transfer_cents: 0
    },
    payments: []
  };

  if (!isJsonRecord(rawPaymentJson)) {
    return defaultBreakdown;
  }

  const rawPayments = Array.isArray(rawPaymentJson.payments) ? rawPaymentJson.payments : [];
  const normalizedPayments = rawPayments
    .map((value) => {
      if (!isJsonRecord(value)) {
        return null;
      }

      const method = normalizeMethod(value.method);
      const amountCents = parsePositiveNumber(value.amount_cents);

      if (!method || amountCents === null) {
        return null;
      }

      return {
        method,
        amount_cents: amountCents
      };
    })
    .filter((value): value is { method: 'CASH' | 'CARD' | 'TRANSFER'; amount_cents: number } => value !== null);

  const amounts = {
    cash_cents: 0,
    card_cents: 0,
    transfer_cents: 0
  };

  for (const payment of normalizedPayments) {
    if (payment.method === 'CASH') {
      amounts.cash_cents += payment.amount_cents;
    } else if (payment.method === 'CARD') {
      amounts.card_cents += payment.amount_cents;
    } else {
      amounts.transfer_cents += payment.amount_cents;
    }
  }

  const rawMode = typeof rawPaymentJson.mode === 'string' ? rawPaymentJson.mode.toUpperCase() : '';
  const mode: DianProviderPaymentBreakdown['mode'] =
    rawMode === 'CASH' || rawMode === 'CARD' || rawMode === 'TRANSFER' || rawMode === 'MIXED'
      ? rawMode
      : normalizedPayments.length <= 1 && normalizedPayments[0]
        ? normalizedPayments[0].method
        : 'MIXED';

  const rawTotal = parsePositiveNumber(rawPaymentJson.total_cents);
  const totalCents = rawTotal ?? fallbackTotalCents;

  return {
    mode,
    total_cents: totalCents,
    amounts,
    payments: normalizedPayments
  };
}

function normalizeTaxLines(rawTaxLinesJson: unknown): DianProviderTaxLinePayload[] {
  if (!Array.isArray(rawTaxLinesJson)) {
    return [];
  }

  return rawTaxLinesJson
    .map((value) => {
      if (!isJsonRecord(value)) {
        return null;
      }

      const rawLineIndex = parsePositiveNumber(value.line_index ?? value.lineIndex);
      const rawBaseCents = parsePositiveNumber(value.base_cents ?? value.baseCents);
      const rawTaxCents = parsePositiveNumber(value.tax_cents ?? value.taxCents);
      const rawRate = value.rate;

      if (
        rawLineIndex === null ||
        rawBaseCents === null ||
        rawTaxCents === null ||
        typeof rawRate !== 'number' ||
        !Number.isFinite(rawRate) ||
        rawRate < 0
      ) {
        return null;
      }

      return {
        lineIndex: rawLineIndex,
        category: normalizeTaxCategory(value.category),
        base_cents: rawBaseCents,
        tax_cents: rawTaxCents,
        rate: rawRate
      };
    })
    .filter((value): value is DianProviderTaxLinePayload => value !== null)
    .sort((a, b) => a.lineIndex - b.lineIndex);
}

function toProviderItems(
  rows: SaleItemRow[],
  taxLines: DianProviderTaxLinePayload[]
): DianProviderSaleItemPayload[] {
  return rows.map((row, lineIndex) => {
    const taxLine = taxLines[lineIndex];
    const taxCategory = normalizeTaxCategory(row.tax_category);

    return {
      id: row.id,
      product_id: row.product_id,
      product_name: row.product_name,
      barcode: row.barcode,
      tax_category: taxCategory,
      category: taxLine?.category ?? taxCategory,
      base_cents: taxLine?.base_cents ?? row.line_total_cents,
      tax_cents: taxLine?.tax_cents ?? 0,
      rate: taxLine?.rate ?? 0,
      qty: Number(row.qty),
      price_cents: row.price_cents,
      line_total_cents: row.line_total_cents
    };
  });
}

function buildIdempotencyKey(payloadJson: unknown, tenantId: string, saleId: string): string {
  if (isJsonRecord(payloadJson)) {
    const candidate = payloadJson.idempotency_key;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return `sale:${tenantId}:${saleId}`;
}

async function claimOutboxEvent(
  pool: Pool,
  outboxEventId: string,
  claimWindowMs: number
): Promise<OutboxEventRow | null> {
  const { rows } = await pool.query<OutboxEventRow>(
    `
      UPDATE outbox_events
      SET next_retry_at = NOW() + ($2 * INTERVAL '1 millisecond')
      WHERE id = $1
        AND type = 'SALE_CREATED'
        AND status IN ('PENDING', 'FAILED')
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      RETURNING id, tenant_id, aggregate_id, status, attempts, payload_json
    `,
    [outboxEventId, claimWindowMs]
  );

  return rows[0] ?? null;
}

async function getOrCreateDianDocument(
  pool: Pool,
  tenantId: string,
  saleId: string
): Promise<DianDocumentRow> {
  const found = await pool.query<DianDocumentRow>(
    `
      SELECT id, status, cude
      FROM dian_documents
      WHERE tenant_id = $1
        AND sale_id = $2
        AND document_type = 'INVOICE'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, saleId]
  );

  const existing = found.rows[0];
  if (existing) {
    return existing;
  }

  const inserted = await pool.query<DianDocumentRow>(
    `
      INSERT INTO dian_documents (
        id,
        tenant_id,
        sale_id,
        document_type,
        parent_document_id,
        provider,
        status,
        cude,
        provider_payload_json,
        provider_response_json
      )
      VALUES ($1, $2, $3, 'INVOICE', NULL, $4, 'PENDING', NULL, '{}'::jsonb, NULL)
      RETURNING id, status, cude
    `,
    [randomUUID(), tenantId, saleId, env.DIAN_PROVIDER]
  );

  return inserted.rows[0]!;
}

async function loadProviderPayload(
  pool: Pool,
  tenantId: string,
  saleId: string,
  idempotencyKey: string
): Promise<DianProviderEmitSaleInput> {
  const headerResult = await pool.query<SaleHeaderRow>(
    `
      SELECT
        s.id AS sale_id,
        s.sale_number::text AS sale_number,
        s.created_at,
        s.subtotal_cents,
        s.discount_cents,
        s.total_cents,
        s.tax_total_cents,
        s.tax_lines_json,
        s.payment_json,
        t.tax_mode,
        t.id AS tenant_id,
        t.name AS tenant_name,
        t.nit AS tenant_nit,
        t.business_name AS tenant_business_name,
        b.id AS branch_id,
        b.name AS branch_name,
        b.address AS branch_address
      FROM sales s
      INNER JOIN tenants t ON t.id = s.tenant_id
      INNER JOIN branches b ON b.id = s.branch_id AND b.tenant_id = s.tenant_id
      WHERE s.tenant_id = $1
        AND s.id = $2
      LIMIT 1
    `,
    [tenantId, saleId]
  );

  const header = headerResult.rows[0];
  if (!header) {
    throw new Error(`Sale not found for tenant=${tenantId} sale=${saleId}`);
  }

  const taxMode = normalizeTaxMode(header.tax_mode);
  const taxLines = normalizeTaxLines(header.tax_lines_json);
  const taxTotalCents = header.tax_total_cents;

  const itemsResult = await pool.query<SaleItemRow>(
    `
      SELECT
        si.id,
        si.product_id,
        si.qty::text AS qty,
        si.price_cents,
        si.line_total_cents,
        p.name AS product_name,
        p.barcode,
        p.tax_category
      FROM sale_items si
      INNER JOIN products p ON p.id = si.product_id AND p.tenant_id = si.tenant_id
      WHERE si.tenant_id = $1
        AND si.sale_id = $2
      ORDER BY si.id ASC
    `,
    [tenantId, saleId]
  );

  const items = toProviderItems(itemsResult.rows, taxLines);
  const payments = normalizePaymentBreakdown(header.payment_json, header.total_cents);

  return {
    sale_id: header.sale_id,
    tenant_id: header.tenant_id,
    branch_id: header.branch_id,
    taxMode,
    idempotency_key: idempotencyKey,
    tenant: {
      id: header.tenant_id,
      nit: header.tenant_nit,
      name: header.tenant_name,
      business_name: header.tenant_business_name
    },
    branch: {
      id: header.branch_id,
      name: header.branch_name,
      address: header.branch_address
    },
    sale: {
      id: header.sale_id,
      sale_number: parseSaleNumber(header.sale_number),
      created_at: header.created_at.toISOString(),
      subtotal_cents: header.subtotal_cents,
      discount_cents: header.discount_cents,
      total_cents: header.total_cents,
      tax_total_cents: taxTotalCents,
      tax_lines: taxLines,
      payments,
      items
    }
  };
}

async function markOutboxSent(pool: Pool, outboxEventId: string, attempts: number): Promise<void> {
  await pool.query(
    `
      UPDATE outbox_events
      SET status = 'SENT',
          attempts = $2,
          next_retry_at = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
    [outboxEventId, attempts]
  );
}

async function markOutboxFailed(
  pool: Pool,
  outboxEventId: string,
  attempts: number,
  nextRetryAt: Date
): Promise<void> {
  await pool.query(
    `
      UPDATE outbox_events
      SET status = 'FAILED',
          attempts = $2,
          next_retry_at = $3,
          updated_at = NOW()
      WHERE id = $1
    `,
    [outboxEventId, attempts, nextRetryAt]
  );
}

async function updateDianDocumentMetadata(
  pool: Pool,
  dianDocumentId: string,
  providerPayload: DianProviderEmitSaleInput,
  providerResponse: Record<string, unknown> | null,
  status?: DianStatus,
  cude?: string | null
): Promise<void> {
  const payloadJson = JSON.stringify(providerPayload);
  const responseJson = providerResponse ? JSON.stringify(providerResponse) : null;

  await pool.query(
    `
      UPDATE dian_documents
      SET provider_payload_json = $2::jsonb,
          provider_response_json = $3::jsonb,
          status = COALESCE($4, status),
          cude = COALESCE($5, cude),
          updated_at = NOW()
      WHERE id = $1
    `,
    [dianDocumentId, payloadJson, responseJson, status ?? null, cude ?? null]
  );
}

=======
>>>>>>> aa2b4ca (refactor)
export function buildOutboxSaleCreatedProcessor({
  pool,
  provider
}: BuildOutboxSaleCreatedProcessorInput) {
  return async (job: Job<OutboxSaleCreatedJobData>): Promise<void> => {
    const claimWindowMs = Math.max(env.OUTBOX_POLL_INTERVAL_MS * 4, 30000);
    const claimedEvent = await claimOutboxEvent(pool, job.data.outboxEventId, claimWindowMs);
    if (!claimedEvent) {
      await job.log(`Outbox event ${job.data.outboxEventId} no está pendiente o ya fue tomado`);
      return;
    }

    const saleId = claimedEvent.aggregate_id;
    const tenantId = claimedEvent.tenant_id;
    const nextAttemptNumber = claimedEvent.attempts + 1;
    const idempotencyKey = buildIdempotencyKey(claimedEvent.payload_json, tenantId, saleId);

    const dianDocument = await getOrCreateDianDocument(pool, tenantId, saleId);

    logWorkerInfo({
      event: 'dian_outbox_job_started',
      message: 'Processing SALE_CREATED outbox event',
      job_id: job.id?.toString(),
      outbox_event_id: claimedEvent.id,
      sale_id: saleId,
      tenant_id: tenantId,
      attempt: nextAttemptNumber,
      dian_document_id: dianDocument.id,
      details: {
        current_dian_status: dianDocument.status
      }
    });

    const emissionBlockReason = getDianEmissionBlockReason(dianDocument.status, dianDocument.cude);
    if (emissionBlockReason) {
      await markOutboxSent(pool, claimedEvent.id, claimedEvent.attempts);
      logWorkerInfo({
        event: 'dian_outbox_job_skipped',
        message: 'Skipped DIAN emission due to idempotency guard',
        job_id: job.id?.toString(),
        outbox_event_id: claimedEvent.id,
        sale_id: saleId,
        tenant_id: tenantId,
        attempt: nextAttemptNumber,
        dian_document_id: dianDocument.id,
        provider_result: 'SKIPPED',
        reason: emissionBlockReason,
        details: {
          current_dian_status: dianDocument.status
        }
      });
      await job.log(
        `Outbox ${claimedEvent.id} omitido por idempotencia. document=${dianDocument.id} status=${dianDocument.status} reason=${emissionBlockReason}`
      );
      return;
    }

    const providerPayload = await loadProviderPayload(pool, tenantId, saleId, idempotencyKey);

    try {
      const providerResult = await provider.emitSale(providerPayload);
      const transitionPlan = planDianStatusTransition(dianDocument.status, providerResult.status);

      await updateDianDocumentMetadata(
        pool,
        dianDocument.id,
        providerPayload,
        providerResult.raw,
        transitionPlan.finalStatus,
        providerResult.cude
      );
      await markOutboxSent(pool, claimedEvent.id, nextAttemptNumber);
      logWorkerInfo({
        event: 'dian_outbox_job_succeeded',
        message: 'DIAN emission completed for sale',
        job_id: job.id?.toString(),
        outbox_event_id: claimedEvent.id,
        sale_id: saleId,
        tenant_id: tenantId,
        attempt: nextAttemptNumber,
        dian_document_id: dianDocument.id,
        dian_transition: formatDianStatusTransitions(transitionPlan.transitions),
        provider_result: providerResult.status,
        details: {
          final_dian_status: transitionPlan.finalStatus,
          cude: providerResult.cude ?? null
        }
      });
      await job.log(
        `Outbox ${claimedEvent.id} procesado. document=${dianDocument.id} provider_status=${providerResult.status} final_status=${transitionPlan.finalStatus} transitions=${formatDianStatusTransitions(transitionPlan.transitions)} cude=${providerResult.cude}`
      );
      return;
    } catch (error) {
      const nextRetryAt = computeNextRetryAt(
        nextAttemptNumber,
        new Date(),
        env.OUTBOX_RETRY_BASE_MS,
        env.OUTBOX_RETRY_MAX_MS
      );

      const errorPayload = {
        provider: env.DIAN_PROVIDER,
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      await updateDianDocumentMetadata(pool, dianDocument.id, providerPayload, errorPayload);
      await markOutboxFailed(pool, claimedEvent.id, nextAttemptNumber, nextRetryAt);
      logWorkerError({
        event: 'dian_outbox_job_failed',
        message: 'DIAN emission failed and will be retried',
        job_id: job.id?.toString(),
        outbox_event_id: claimedEvent.id,
        sale_id: saleId,
        tenant_id: tenantId,
        attempt: nextAttemptNumber,
        dian_document_id: dianDocument.id,
        dian_transition: `${dianDocument.status}->${dianDocument.status}`,
        provider_result: 'ERROR',
        next_retry_at: nextRetryAt.toISOString(),
        details: {
          current_dian_status: dianDocument.status,
          provider: env.DIAN_PROVIDER
        },
        error
      });
      await job.log(
        `Outbox ${claimedEvent.id} falló antes de completar transición DIAN. document=${dianDocument.id} current_status=${dianDocument.status} next_retry_at=${nextRetryAt.toISOString()} error=${errorPayload.error}`
      );

      throw error;
    }
  };
}
