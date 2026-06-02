import { getPendingJournalEntries, markJournalEntrySynced } from './operation-journal.js';

let syncInterval: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;

export function startJournalSyncWorker(apiUrl: string, getToken: () => string | null, intervalMs = 15000) {
  if (syncInterval) clearInterval(syncInterval);
  
  syncInterval = setInterval(async () => {
    if (isSyncing) return;
    if (!navigator.onLine) return; // Basic network check
    
    try {
      isSyncing = true;
      const pending = await getPendingJournalEntries();
      if (pending.length === 0) return;

      const token = getToken();
      if (!token) return;

      // In a real enterprise app, we might send them in batches,
      // here we send them as a single bulk sync request.
      const response = await fetch(`${apiUrl}/api/v1/journal/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ operations: pending })
      });

      if (response.ok) {
        const result = await response.json();
        // Assuming the backend returns an array of synced operation IDs
        const syncedIds: string[] = result.synced_ids || [];
        for (const id of syncedIds) {
          await markJournalEntrySynced(id);
        }
      } else {
        console.warn('[JournalSyncWorker] Sync failed with status:', response.status);
      }
    } catch (error) {
      console.error('[JournalSyncWorker] Error during sync:', error);
    } finally {
      isSyncing = false;
    }
  }, intervalMs);
}

export function stopJournalSyncWorker() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
