interface WorkerLogRecord {
  event: string;
  message: string;
  job_id?: string | undefined;
  outbox_event_id?: string | undefined;
  sale_id?: string | undefined;
  return_id?: string | undefined;
  tenant_id?: string | undefined;
  attempt?: number | undefined;
  dian_document_id?: string | undefined;
  parent_document_id?: string | null | undefined;
  dian_transition?: string | undefined;
  provider_result?: string | undefined;
  next_retry_at?: string | undefined;
  reason?: string | undefined;
  details?: Record<string, unknown> | undefined;
  error?: unknown;
}

function serializeError(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}

function writeStructuredLog(level: 'info' | 'error', payload: WorkerLogRecord) {
  const line = JSON.stringify({
    level,
    service: 'worker',
    timestamp: new Date().toISOString(),
    ...payload,
    error: serializeError(payload.error)
  });

  if (level === 'error') {
    console.error(line);
    return;
  }

  console.info(line);
}

export function logWorkerInfo(payload: WorkerLogRecord) {
  writeStructuredLog('info', payload);
}

export function logWorkerError(payload: WorkerLogRecord) {
  writeStructuredLog('error', payload);
}
