import { z } from 'zod';

export interface OutboxSaleCreatedJobData {
  outboxEventId: string;
}

export interface OutboxSaleVoidedJobData {
  outboxEventId: string;
}

export interface OutboxLowStockAlertJobData {
  outboxEventId: string;
}

export type AnyOutboxJobData =
  | OutboxSaleCreatedJobData
  | OutboxSaleVoidedJobData
  | OutboxLowStockAlertJobData;

export const saleCreatedPayloadSchema = z.object({
  sale_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  cash_session_id: z.string().uuid().nullable().optional(),
  sale_number: z.number().optional(),
  total_cents: z.number().optional(),
  idempotency_key: z.string().optional()
}).passthrough();

export const saleVoidedPayloadSchema = z.object({
  sale_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  invoice_dian_document_id: z.string().uuid().optional(),
  sale_number: z.number().optional(),
  total_cents: z.number().optional(),
  void_reason: z.string().optional(),
  idempotency_key: z.string().optional()
}).passthrough();
