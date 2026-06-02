import Dexie, { type Table } from 'dexie';

export type OperationType =
  | 'CREATE_SALE'
  | 'VOID_SALE'
  | 'CREATE_CASH_SESSION'
  | 'CLOSE_CASH_SESSION'
  | 'CREATE_PRODUCT'
  | 'UPDATE_PRODUCT';

export interface JournalEntry<TPayload = any> {
  id: string;
  type: OperationType;
  timestamp: string;
  payload: TPayload;
  status: 'PENDING' | 'SYNCED' | 'FAILED';
  retryCount: number;
  lastError?: string;
  idempotencyKey: string;
}

class JournalDB extends Dexie {
  journal_entries!: Table<JournalEntry, string>;

  constructor() {
    super('pos-journal-db');
    this.version(1).stores({
      journal_entries: 'id, status, timestamp'
    });
  }
}

let db: JournalDB | null = null;
const memoryJournal = new Map<string, JournalEntry>();
let forceMemoryFallback = false;

function getJournalDB(): JournalDB | null {
  if (forceMemoryFallback) return null;
  if (!db) {
    try {
      db = new JournalDB();
    } catch (err: any) {
      console.warn('[OperationJournal] Dexie initialization failed, switching to memory Map:', err);
      forceMemoryFallback = true;
      return null;
    }
  }
  return db;
}

export async function appendToJournal<TPayload>(
  type: OperationType,
  payload: TPayload,
  idempotencyKey: string = crypto.randomUUID()
): Promise<JournalEntry<TPayload>> {
  const entry: JournalEntry<TPayload> = {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
    status: 'PENDING',
    retryCount: 0,
    idempotencyKey,
  };

  const journal = getJournalDB();
  if (journal) {
    try {
      await journal.journal_entries.put(entry);
    } catch (err: any) {
      console.warn('[OperationJournal] DB put failed, using memory', err);
      forceMemoryFallback = true;
      memoryJournal.set(entry.id, entry);
    }
  } else {
    memoryJournal.set(entry.id, entry);
  }

  return entry;
}

export async function getPendingJournalEntries(): Promise<JournalEntry[]> {
  const journal = getJournalDB();
  if (journal) {
    try {
      return await journal.journal_entries.where('status').equals('PENDING').toArray();
    } catch (err: any) {
      forceMemoryFallback = true;
      console.warn('[OperationJournal] DB get failed, using memory', err);
    }
  }

  return Array.from(memoryJournal.values()).filter(e => e.status === 'PENDING');
}

export async function markJournalEntrySynced(id: string): Promise<void> {
  const journal = getJournalDB();
  if (journal) {
    try {
      await journal.journal_entries.update(id, { status: 'SYNCED' });
    } catch (err: any) {
      forceMemoryFallback = true;
    }
  }

  if (memoryJournal.has(id)) {
    const entry = memoryJournal.get(id)!;
    entry.status = 'SYNCED';
  }
}
