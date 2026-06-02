import { useCallback, useEffect, useState, useRef } from 'react';
import { ApiClientError, type AuthSession, type CreateSaleRequest } from '../lib/api';
import {
  flushPendingSales,
  getPendingSalesCount,
  listPendingSales,
  type PendingSaleRecord
} from '../lib/offline-queue';
import type { PosContext } from '../lib/session';
import type { PosApiClient } from '../types';

function isClientUuidAlreadyRegistered(error: unknown): boolean {
  if (!(error instanceof ApiClientError) || error.status !== 409) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('client_uuid') ||
    message.includes('idempot') ||
    message.includes('ya existe') ||
    message.includes('already exists')
  );
}

function shouldStopSyncOnError(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) {
    return false;
  }

  return error.isNetworkError || error.status === 401;
}

function getGlobalSyncErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 401) {
    return 'Tu sesión expiró. Inicia sesión de nuevo antes de sincronizar ventas pendientes.';
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'No fue posible sincronizar las ventas pendientes';
}

export function usePendingSalesSync({
  api,
  posContext,
  session
}: {
  api: Pick<PosApiClient, 'createSale'> & {
    createSale: (payload: CreateSaleRequest) => Promise<unknown>;
  };
  posContext: PosContext | null;
  session: AuthSession | null;
}) {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [pendingSales, setPendingSales] = useState<PendingSaleRecord[]>([]);
  const [pendingSalesCount, setPendingSalesCount] = useState(0);
  const [syncingPendingSales, setSyncingPendingSales] = useState(false);
  const [syncingPendingSaleIds, setSyncingPendingSaleIds] = useState<string[]>([]);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncInProgressRef = useRef(false);

  const refreshPendingSales = useCallback(async () => {
    const branchId = posContext?.branchId;
    const [pendingCount, queuedSales] = await Promise.all([
      getPendingSalesCount(branchId),
      listPendingSales(branchId)
    ]);
    setPendingSalesCount(pendingCount);
    setPendingSales(queuedSales);
    return {
      pendingCount,
      queuedSales
    };
  }, []);

  const createSaleForSync = useCallback(
    async (payload: CreateSaleRequest) => {
      try {
        await api.createSale(payload);
      } catch (error) {
        if (isClientUuidAlreadyRegistered(error)) {
          return;
        }

        throw error;
      }
    },
    [api]
  );

  const syncPendingSales = useCallback(
    async (recordId?: string) => {
      if (!session || syncInProgressRef.current) {
        return;
      }

      syncInProgressRef.current = true;
      setSyncingPendingSales(true);
      setSyncError(null);
      setSyncMessage(null);

      const { pendingCount, queuedSales } = await refreshPendingSales();
      const targetIds = recordId
        ? queuedSales.filter((pendingSale) => pendingSale.id === recordId).map((pendingSale) => pendingSale.id)
        : queuedSales.map((pendingSale) => pendingSale.id);

      if (pendingCount === 0 || targetIds.length === 0) {
        setSyncingPendingSales(false);
        syncInProgressRef.current = false;
        if (!recordId) {
          setSyncMessage('No hay ventas pendientes por sincronizar.');
        }
        return;
      }

      setSyncingPendingSaleIds(targetIds);

      try {
        const result = await flushPendingSales(createSaleForSync, {
          recordId,
          shouldStopOnError: shouldStopSyncOnError,
          branchId: posContext?.branchId
        });
        await refreshPendingSales();

        if (result.syncedCount > 0 && result.failedCount === 0) {
          setSyncMessage(
            `${result.syncedCount} venta(s) pendiente(s) sincronizada(s) correctamente.`
          );
          return;
        }

        if (result.syncedCount > 0) {
          setSyncError(
            `Se sincronizaron ${result.syncedCount} venta(s), pero ${result.failedCount} quedó/quedaron con error.`
          );
          return;
        }

        const firstError = result.outcomes.find((outcome) => outcome.status === 'FAILED')?.errorMessage;
        setSyncError(firstError ?? 'No se pudieron sincronizar las ventas pendientes. Intenta de nuevo.');
      } catch (syncPendingError) {
        setSyncError(getGlobalSyncErrorMessage(syncPendingError));
      } finally {
        setSyncingPendingSaleIds([]);
        setSyncingPendingSales(false);
        syncInProgressRef.current = false;
      }
    },
    [createSaleForSync, refreshPendingSales, session]
  );

  const retryPendingSale = useCallback(
    async (recordId: string) => {
      await syncPendingSales(recordId);
    },
    [syncPendingSales]
  );

  useEffect(() => {
    if (!session || !posContext) {
      setPendingSales([]);
      setPendingSalesCount(0);
      setSyncingPendingSaleIds([]);
      return;
    }

    void refreshPendingSales();
  }, [posContext, refreshPendingSales, session]);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      if (!session || !posContext || pendingSalesCount === 0 || syncingPendingSales) {
        return;
      }

      void syncPendingSales();
    };

    const onOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [pendingSalesCount, posContext, session, syncPendingSales, syncingPendingSales]);

  return {
    isOnline,
    pendingSales,
    pendingSalesCount,
    refreshPendingSalesCount: refreshPendingSales,
    retryPendingSale,
    syncError,
    syncMessage,
    syncPendingSales,
    syncingPendingSaleIds,
    syncingPendingSales,
    hasFailedPendingSales: pendingSales.some((pendingSale) => pendingSale.sync_state === 'FAILED')
  };
}
