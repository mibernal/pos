import type { Pool, PoolClient } from 'pg';
import type { DianStatus } from '@pos-dian/shared';
import type { DianProviderEmitSaleInput } from '@pos-dian/shared/types/dian-provider.js';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';

export interface OutboxEventRow {
  id: string;
  tenant_id: string;
  aggregate_id: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  payload_json: unknown;
}

export interface DianDocumentRow {
  id: string;
  status: DianStatus;
  cude: string | null;
}

export async function claimOutboxEvent(
  pool: Pool | PoolClient,
  outboxEventId: string,
  claimWindowMs: number
): Promise<OutboxEventRow | null> {
  const { rows } = await pool.query<OutboxEventRow>(
    `
      UPDATE outbox_events
      SET next_retry_at = NOW() + ($2 * INTERVAL '1 millisecond')
      WHERE id = $1
        AND status IN ('PENDING', 'FAILED')
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      RETURNING id, tenant_id, aggregate_id, status, attempts, payload_json
    `,
    [outboxEventId, claimWindowMs]
  );

  return rows[0] ?? null;
}

export async function getOrCreateDianDocument(
  pool: Pool | PoolClient,
  tenantId: string,
  saleId: string,
  documentType: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' = 'INVOICE',
  parentDocumentId?: string | null
): Promise<DianDocumentRow> {
  const found = await pool.query<DianDocumentRow>(
    `
      SELECT id, status, cude
      FROM dian_documents
      WHERE tenant_id = $1
        AND sale_id = $2
        AND document_type = $3
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, saleId, documentType]
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
      VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', NULL, '{}'::jsonb, NULL)
      RETURNING id, status, cude
    `,
    [randomUUID(), tenantId, saleId, documentType, parentDocumentId ?? null, env.DIAN_PROVIDER]
  );

  return inserted.rows[0]!;
}

export async function markOutboxSent(pool: Pool | PoolClient, outboxEventId: string, attempts: number): Promise<void> {
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

export async function markOutboxFailed(
  pool: Pool | PoolClient,
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

export async function updateDianDocumentMetadata(
  pool: Pool | PoolClient,
  dianDocumentId: string,
  providerPayload: DianProviderEmitSaleInput,
  providerResponse: Record<string, unknown> | null,
  status?: DianStatus,
  cude?: string | null
): Promise<void> {
  const payloadJson = JSON.stringify(providerPayload);
  const responseJson = providerResponse ? JSON.stringify(providerResponse) : null;

  if (status && cude) {
    await pool.query(
      `
        UPDATE dian_documents
        SET provider_payload_json = $2::jsonb,
            provider_response_json = $3::jsonb,
            status = $4,
            cude = $5,
            updated_at = NOW()
        WHERE id = $1
      `,
      [dianDocumentId, payloadJson, responseJson, status, cude]
    );
  } else if (status) {
    await pool.query(
      `
        UPDATE dian_documents
        SET provider_payload_json = $2::jsonb,
            provider_response_json = $3::jsonb,
            status = $4,
            updated_at = NOW()
        WHERE id = $1
      `,
      [dianDocumentId, payloadJson, responseJson, status]
    );
  } else {
    await pool.query(
      `
        UPDATE dian_documents
        SET provider_payload_json = $2::jsonb,
            provider_response_json = $3::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
      [dianDocumentId, payloadJson, responseJson]
    );
  }
}
