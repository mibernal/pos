import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WaiterShift, WaiterShiftSummary } from '@pos-dian/shared';
import { useSession } from '../../auth/context/SessionProvider';
import { waiterKeys } from '../../../shared/query-keys';

/** Devuelve el mensaje del servidor: «PIN incorrecto» tiene que llegar tal cual a la pantalla. */
async function fallar(response: Response, porDefecto: string): Promise<never> {
  let mensaje = porDefecto;
  try {
    const cuerpo = await response.json();
    mensaje = cuerpo?.error?.message ?? cuerpo?.message ?? porDefecto;
  } catch {
    // Sin JSON no hay nada mejor que decir que el mensaje por defecto.
  }
  throw new Error(mensaje);
}

function cabeceras(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export function useOpenWaiterShifts(branchId: string) {
  const { token } = useSession();

  return useQuery({
    queryKey: waiterKeys.shifts(branchId),
    enabled: Boolean(token) && Boolean(branchId),
    queryFn: async (): Promise<WaiterShift[]> => {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/waiter-shifts?branch_id=${branchId}&open_only=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) await fallar(response, 'No se pudieron cargar los turnos.');
      return response.json();
    }
  });
}

export function useOpenWaiterShift() {
  const queryClient = useQueryClient();
  const { token } = useSession();

  return useMutation({
    mutationFn: async (payload: {
      branch_id: string;
      pin?: string;
      waiter_id?: string;
      cash_session_id?: string | null;
      table_ids?: string[];
    }): Promise<WaiterShift> => {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/waiter-shifts/open`, {
        method: 'POST',
        headers: cabeceras(token!),
        body: JSON.stringify(payload)
      });
      if (!response.ok) await fallar(response, 'No se pudo abrir el turno.');
      return response.json();
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: waiterKeys.shifts(variables.branch_id) });
    }
  });
}

export function useCloseWaiterShift(branchId: string) {
  const queryClient = useQueryClient();
  const { token } = useSession();

  return useMutation({
    mutationFn: async (shiftId: string): Promise<WaiterShiftSummary> => {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/waiter-shifts/${shiftId}/close`, {
        method: 'POST',
        headers: cabeceras(token!),
        body: JSON.stringify({})
      });
      if (!response.ok) await fallar(response, 'No se pudo cerrar el turno.');
      return response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: waiterKeys.shifts(branchId) });
    }
  });
}

export function useWaiterShiftSummary(shiftId: string | null) {
  const { token } = useSession();

  return useQuery({
    queryKey: waiterKeys.shiftSummary(shiftId),
    enabled: Boolean(token) && Boolean(shiftId),
    queryFn: async (): Promise<WaiterShiftSummary> => {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/waiter-shifts/${shiftId}/summary`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) await fallar(response, 'No se pudo cargar el corte del turno.');
      return response.json();
    }
  });
}
