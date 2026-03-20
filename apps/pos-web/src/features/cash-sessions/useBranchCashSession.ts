import { useEffect, useState } from 'react';
import type { BranchItem, CashSession } from '../../lib/api';
import type { PosApiClient } from '../../types';

export function useBranchCashSession({
  api,
  branches,
  selectedBranchId
}: {
  api: PosApiClient;
  branches: BranchItem[];
  selectedBranchId: string;
}) {
  const [currentSession, setCurrentSession] = useState<CashSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedBranchId || branches.length === 0) {
      setCurrentSession(null);
      setSessionError(null);
      return;
    }

    const branch = branches.find((item) => item.id === selectedBranchId) ?? null;
    if (!branch) {
      setCurrentSession(null);
      return;
    }

    if (branch.current_cash_session) {
      setCurrentSession(branch.current_cash_session);
      setSessionError(null);
      return;
    }

    let cancelled = false;

    setCheckingSession(true);
    setSessionError(null);

    void api
      .getCurrentCashSession(selectedBranchId)
      .then((response) => {
        if (!cancelled) {
          setCurrentSession(response.cash_session);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setSessionError(
            loadError instanceof Error
              ? loadError.message
              : 'No fue posible validar la sesión de caja actual'
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCheckingSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, branches, selectedBranchId]);

  return {
    checkingSession,
    currentSession,
    sessionError,
    setCurrentSession
  };
}
