import type { CreateSaleRequest } from './api';

const DB_NAME = 'pos-dian-offline';
const STORE_NAME = 'pending-sales';
const DB_VERSION = 2;

export type PendingSaleSyncState = 'PENDING' | 'FAILED' | 'ABORTED';

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

let forceMemoryFallback = false;

function isDbAvailable(): boolean {
  return !forceMemoryFallback && typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  if (!isDbAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available or disabled'));
  }

  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        forceMemoryFallback = true;
        reject(request.error || new Error('IndexedDB open error'));
      };
    } catch (error) {
      forceMemoryFallback = true;
      reject(error);
    }
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
    sync_state: record?.sync_state === 'FAILED' ? 'FAILED' : record?.sync_state === 'ABORTED' ? 'ABORTED' : 'PENDING',
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
  if (!isDbAvailable()) return memoryFallbackStore.get(recordId) ?? null;

  try {
    const db = await openDb();
    const record = await new Promise<PendingSaleRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(recordId);
      request.onsuccess = () => resolve(request.result ? normalizePendingSaleRecord(request.result) : null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return record;
  } catch (error) {
    console.warn('IDB get failed, fallback to memory', error);
    forceMemoryFallback = true;
    return memoryFallbackStore.get(recordId) ?? null;
  }
}

async function putPendingSale(record: PendingSaleRecord): Promise<void> {
  if (!isDbAvailable()) {
    memoryFallbackStore.set(record.id, record);
    return;
  }

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (error) {
    console.warn('IDB put failed, fallback to memory', error);
    forceMemoryFallback = true;
    memoryFallbackStore.set(record.id, record);
  }
}

async function deletePendingSale(recordId: string): Promise<void> {
  if (!isDbAvailable()) {
    memoryFallbackStore.delete(recordId);
    return;
  }

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(recordId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (error) {
    console.warn('IDB delete failed, fallback to memory', error);
    forceMemoryFallback = true;
    memoryFallbackStore.delete(recordId);
  }
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

export async function listPendingSales(branchId?: string): Promise<PendingSaleRecord[]> {
  if (!isDbAvailable()) {
    const all = sortByQueuedAt([...memoryFallbackStore.values()]);
    return branchId ? all.filter(r => r.payload.branch_id === branchId) : all;
  }

  try {
    const db = await openDb();
    const records = await new Promise<PendingSaleRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        let records = (request.result as unknown[]).map((record) => normalizePendingSaleRecord(record));
        if (branchId) {
          records = records.filter(r => r.payload.branch_id === branchId);
        }
        resolve(records);
      };
      request.onerror = () => reject(request.error);
    });
    db.close();
    return sortByQueuedAt(records);
  } catch (error) {
    console.warn('IDB list failed, fallback to memory', error);
    forceMemoryFallback = true;
    const all = sortByQueuedAt([...memoryFallbackStore.values()]);
    return branchId ? all.filter(r => r.payload.branch_id === branchId) : all;
  }
}

export async function getPendingSalesCount(branchId?: string): Promise<number> {
  if (!isDbAvailable()) {
    return branchId 
      ? [...memoryFallbackStore.values()].filter(r => r.payload.branch_id === branchId).length 
      : memoryFallbackStore.size;
  }

  if (branchId) {
    const records = await listPendingSales(branchId);
    return records.length;
  }

  try {
    const db = await openDb();
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return count;
  } catch (error) {
    console.warn('IDB count failed, fallback to memory', error);
    forceMemoryFallback = true;
    return memoryFallbackStore.size;
  }
}

export async function clearPendingSales(): Promise<void> {
  if (!isDbAvailable()) {
    memoryFallbackStore.clear();
    return;
  }

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (error) {
    console.warn('IDB clear failed, fallback to memory', error);
    forceMemoryFallback = true;
    memoryFallbackStore.clear();
  }
}

export async function flushPendingSales(
  handler: (salePayload: CreateSaleRequest) => Promise<void>,
  options?: {
    recordId?: string;
    shouldStopOnError?: (error: unknown) => boolean;
    branchId?: string;
  }
): Promise<FlushPendingSalesResult> {
  const MAX_SYNC_ATTEMPTS = 5;
  const allPendingSales = await listPendingSales(options?.branchId);
  const pendingSales = options?.recordId
    ? allPendingSales.filter((pendingSale) => pendingSale.id === options.recordId)
    : allPendingSales.filter((pendingSale) => pendingSale.sync_state !== 'ABORTED');

  let syncedCount = 0;
  let failedCount = 0;
  const outcomes: FlushPendingSalesResult['outcomes'] = [];

  const BATCH_SIZE = 5;
  for (let i = 0; i < pendingSales.length; i += BATCH_SIZE) {
    const batch = pendingSales.slice(i, i + BATCH_SIZE);
    let shouldStop = false;

    const results = await Promise.allSettled(
      batch.map(async (pendingSale) => {
        try {
          await handler(pendingSale.payload);
          await deletePendingSale(pendingSale.id);
          return { status: 'SYNCED' as const, record: pendingSale };
        } catch (error) {
          const syncAttempts = pendingSale.sync_attempts + 1;
          const syncState = syncAttempts >= MAX_SYNC_ATTEMPTS ? 'ABORTED' : 'FAILED';
          const failedRecord: PendingSaleRecord = {
            ...pendingSale,
            sync_state: syncState,
            sync_attempts: syncAttempts,
            last_error: getSyncErrorMessage(error),
            last_attempt_at: new Date().toISOString()
          };
          await putPendingSale(failedRecord);
          return { status: 'FAILED' as const, record: pendingSale, failedRecord, error };
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const value = result.value;
        if (value.status === 'SYNCED') {
          syncedCount += 1;
          outcomes.push({
            recordId: value.record.id,
            status: 'SYNCED',
            errorMessage: null
          });
        } else {
          failedCount += 1;
          outcomes.push({
            recordId: value.record.id,
            status: 'FAILED',
            errorMessage: value.failedRecord.last_error
          });
          if (options?.shouldStopOnError?.(value.error)) {
            shouldStop = true;
          }
        }
      } else {
        // Fallback for uncaught promise rejections
        shouldStop = true;
      }
    }

    if (shouldStop) {
      break;
    }
  }

  return {
    syncedCount,
    failedCount,
    remainingCount: await getPendingSalesCount(options?.branchId),
    outcomes
  };
}
