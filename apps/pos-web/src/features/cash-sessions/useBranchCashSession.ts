import { useEffect, useState } from 'react';
import type { CashSession } from '../../lib/api';
import { useApi } from '../auth';

export function useBranchCashSession({ selectedTerminalId
}: {
  selectedTerminalId: string;
}) {
  const api = useApi();
  const [currentSession, setCurrentSession] = useState<CashSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTerminalId || selectedTerminalId === 'undefined' || selectedTerminalId === 'null') {
      setCurrentSession(null);
      setSessionError(null);
      return;
    }

    let cancelled = false;

    setCheckingSession(true);
    setSessionError(null);

    void api
      .getCurrentCashSession(selectedTerminalId)
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
  }, [api, selectedTerminalId]);

  return {
    checkingSession,
    currentSession,
    sessionError,
    setCurrentSession
  };
}
