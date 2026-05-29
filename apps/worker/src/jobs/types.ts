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
