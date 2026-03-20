import type { CreateSaleRequest } from './api';

const DB_NAME = 'pos-dian-offline';
const STORE_NAME = 'pending-sales';
const DB_VERSION = 2;

export type PendingSaleSyncState = 'PENDING' | 'FAILED';

export interface PendingSaleRecord {
  id: string;
  type: 'pending_sale';
  queued_at: string;
  payload: CreateSaleRequest;
  sync_state: PendingSaleSyncState;
  sync_attempts: number;
  last_error: string | null;
  last_attempt_at: string | null;
}

export interface FlushPendingSalesResult {
  syncedCount: number;
  failedCount: number;
  remainingCount: number;
  outcomes: Array<{
    recordId: string;
    status: 'SYNCED' | 'FAILED';
    errorMessage: string | null;
  }>;
}

const memoryFallbackStore = new Map<string, PendingSaleRecord>();

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available in this environment'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function sortByQueuedAt(records: PendingSaleRecord[]): PendingSaleRecord[] {
  return [...records].sort((left, right) => left.queued_at.localeCompare(right.queued_at));
}

function normalizePendingSaleRecord(rawRecord: unknown): PendingSaleRecord {
  const record = rawRecord as Partial<PendingSaleRecord> | undefined;
  const payload = record?.payload as CreateSaleRequest | undefined;
  const id = record?.id ?? payload?.client_uuid ?? '';

  if (!payload || !id) {
    throw new Error('Pending sale record is missing payload or id');
  }

  return {
    id,
    type: 'pending_sale',
    queued_at:
      typeof record?.queued_at === 'string' && record.queued_at.trim().length > 0
        ? record.queued_at
        : new Date().toISOString(),
    payload,
    sync_state: record?.sync_state === 'FAILED' ? 'FAILED' : 'PENDING',
    sync_attempts:
      typeof record?.sync_attempts === 'number' && Number.isFinite(record.sync_attempts)
        ? Math.max(0, Math.trunc(record.sync_attempts))
        : 0,
    last_error:
      typeof record?.last_error === 'string' && record.last_error.trim().length > 0
        ? record.last_error
        : null,
    last_attempt_at:
      typeof record?.last_attempt_at === 'string' && record.last_attempt_at.trim().length > 0
        ? record.last_attempt_at
        : null
  };
}

async function getPendingSale(recordId: string): Promise<PendingSaleRecord | null> {
  if (!isIndexedDbAvailable()) {
    return memoryFallbackStore.get(recordId) ?? null;
  }

  const db = await openDb();

  const record = await new Promise<PendingSaleRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(recordId);
    request.onsuccess = () => {
      const rawRecord = request.result;
      resolve(rawRecord ? normalizePendingSaleRecord(rawRecord) : null);
    };
    request.onerror = () => reject(request.error);
  });

  db.close();
  return record;
}

async function putPendingSale(record: PendingSaleRecord): Promise<void> {
  if (!isIndexedDbAvailable()) {
    memoryFallbackStore.set(record.id, record);
    return;
  }

  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

async function deletePendingSale(recordId: string): Promise<void> {
  if (!isIndexedDbAvailable()) {
    memoryFallbackStore.delete(recordId);
    return;
  }

  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(recordId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

function getSyncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'No fue posible sincronizar la venta pendiente';
}

export async function addPendingSale(payload: CreateSaleRequest): Promise<PendingSaleRecord> {
  const existingRecord = await getPendingSale(payload.client_uuid);
  const record: PendingSaleRecord = {
    id: payload.client_uuid,
    type: 'pending_sale',
    queued_at: existingRecord?.queued_at ?? new Date().toISOString(),
    payload,
    sync_state: 'PENDING',
    sync_attempts: existingRecord?.sync_attempts ?? 0,
    last_error: null,
    last_attempt_at: existingRecord?.last_attempt_at ?? null
  };

  await putPendingSale(record);
  return record;
}

export async function listPendingSales(): Promise<PendingSaleRecord[]> {
  if (!isIndexedDbAvailable()) {
    return sortByQueuedAt([...memoryFallbackStore.values()]);
  }

  const db = await openDb();

  const records = await new Promise<PendingSaleRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () =>
      resolve((request.result as unknown[]).map((record) => normalizePendingSaleRecord(record)));
    request.onerror = () => reject(request.error);
  });

  db.close();
  return sortByQueuedAt(records);
}

export async function getPendingSalesCount(): Promise<number> {
  if (!isIndexedDbAvailable()) {
    return memoryFallbackStore.size;
  }

  const db = await openDb();

  const count = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  db.close();
  return count;
}

export async function clearPendingSales(): Promise<void> {
  if (!isIndexedDbAvailable()) {
    memoryFallbackStore.clear();
    return;
  }

  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

export async function flushPendingSales(
  handler: (salePayload: CreateSaleRequest) => Promise<void>,
  options?: {
    recordId?: string;
    shouldStopOnError?: (error: unknown) => boolean;
  }
): Promise<FlushPendingSalesResult> {
  const allPendingSales = await listPendingSales();
  const pendingSales = options?.recordId
    ? allPendingSales.filter((pendingSale) => pendingSale.id === options.recordId)
    : allPendingSales;

  let syncedCount = 0;
  let failedCount = 0;
  const outcomes: FlushPendingSalesResult['outcomes'] = [];

  for (const pendingSale of pendingSales) {
    try {
      await handler(pendingSale.payload);
      await deletePendingSale(pendingSale.id);
      syncedCount += 1;
      outcomes.push({
        recordId: pendingSale.id,
        status: 'SYNCED',
        errorMessage: null
      });
    } catch (error) {
      const failedRecord: PendingSaleRecord = {
        ...pendingSale,
        sync_state: 'FAILED',
        sync_attempts: pendingSale.sync_attempts + 1,
        last_error: getSyncErrorMessage(error),
        last_attempt_at: new Date().toISOString()
      };
      await putPendingSale(failedRecord);
      failedCount += 1;
      outcomes.push({
        recordId: pendingSale.id,
        status: 'FAILED',
        errorMessage: failedRecord.last_error
      });

      if (options?.shouldStopOnError?.(error)) {
        break;
      }
    }
  }

  return {
    syncedCount,
    failedCount,
    remainingCount: await getPendingSalesCount(),
    outcomes
  };
}
