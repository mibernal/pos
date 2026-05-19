export interface OutboxSaleCreatedJobData {
  outboxEventId: string;
}

export interface OutboxSaleVoidedJobData {
  outboxEventId: string;
}

export type AnyOutboxJobData = OutboxSaleCreatedJobData | OutboxSaleVoidedJobData;
