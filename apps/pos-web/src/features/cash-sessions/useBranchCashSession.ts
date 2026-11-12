import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { CashSession } from '../../lib/api';
import { useApi } from '../auth';
import { cashKeys } from '../../shared/query-keys';

/**
 * La sesión de caja abierta de una terminal.
 *
 * `setCurrentSession` se conserva porque quien abre o cierra la caja ya tiene la sesión
 * resultante en la mano y no tiene sentido volver a pedirla: escribe la caché y sigue.
 * Es lo mismo que hacía el `useState` de antes, salvo que ahora el dato vive en un solo
 * sitio y cualquier otra pantalla que pregunte por esta terminal ve lo mismo.
 */
export function useBranchCashSession({ selectedTerminalId
}: {
  selectedTerminalId: string;
}) {
  const api = useApi();
  const queryClient = useQueryClient();

  // El identificador llega como texto desde la URL y el almacenamiento local, así que
  // puede traer literalmente 'undefined' o 'null'. Pedirle eso al API es un 400 seguro.
  const terminalValida =
    Boolean(selectedTerminalId) && selectedTerminalId !== 'undefined' && selectedTerminalId !== 'null';

  const consulta = useQuery({
    queryKey: cashKeys.currentSession(selectedTerminalId),
    queryFn: () => api.getCurrentCashSession(selectedTerminalId).then((r) => r.cash_session),
    enabled: terminalValida
  });

  const setCurrentSession = useCallback(
    (session: CashSession | null) => {
      queryClient.setQueryData(cashKeys.currentSession(selectedTerminalId), session);
    },
    [queryClient, selectedTerminalId]
  );

  return {
    checkingSession: terminalValida && consulta.isPending,
    currentSession: terminalValida ? consulta.data ?? null : null,
    sessionError:
      consulta.error instanceof Error
        ? consulta.error.message
        : consulta.error
          ? 'No fue posible validar la sesión de caja actual'
          : null,
    setCurrentSession
  };
}
