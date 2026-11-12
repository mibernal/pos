import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../auth/context/SessionProvider';
import type { Waiter, CreateWaiterPayload, UpdateWaiterPayload } from '@pos-dian/shared';
import { waiterKeys } from '../../../shared/query-keys';

/**
 * Devuelve el mensaje que mandó el servidor, no uno inventado aquí.
 *
 * `throw new Error('Failed to create waiter')` tapaba el motivo real: desde que la cuota de
 * meseros se comprueba de verdad, el comercio que la alcanza tiene que leer «has alcanzado
 * el límite de tu plan», no un error en inglés que no le dice qué hacer.
 */
async function fallar(response: Response, porDefecto: string): Promise<never> {
  let mensaje = porDefecto;
  try {
    const cuerpo = await response.json();
    mensaje = cuerpo?.error?.message ?? cuerpo?.message ?? porDefecto;
  } catch {
    // Una respuesta sin JSON deja el mensaje por defecto: no hay nada mejor que decir.
  }
  throw new Error(mensaje);
}

const getWaiters = async (token: string, branchId: string): Promise<Waiter[]> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/waiters`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) await fallar(response, 'No se pudieron cargar los meseros.');
  return response.json();
};

const createWaiter = async (token: string, branchId: string, payload: CreateWaiterPayload): Promise<Waiter> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/waiters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) await fallar(response, 'No se pudo crear el mesero.');
  return response.json();
};

const updateWaiter = async (token: string, branchId: string, id: string, payload: UpdateWaiterPayload): Promise<Waiter> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/waiters/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) await fallar(response, 'No se pudo guardar el mesero.');
  return response.json();
};

export const useGetWaiters = (branchId: string) => {
  const { token } = useSession();
  return useQuery({
    queryKey: waiterKeys.all(branchId),
    queryFn: () => getWaiters(token!, branchId),
    enabled: !!token && !!branchId,
  });
};

export const useCreateWaiter = () => {
  const queryClient = useQueryClient();
  const { token } = useSession();

  return useMutation({
    mutationFn: ({ branchId, payload }: { branchId: string; payload: CreateWaiterPayload }) => 
      createWaiter(token!, branchId, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: waiterKeys.all(variables.branchId) });
    }
  });
};

export const useUpdateWaiter = () => {
  const queryClient = useQueryClient();
  const { token } = useSession();

  return useMutation({
    mutationFn: ({ branchId, id, payload }: { branchId: string; id: string; payload: UpdateWaiterPayload }) => 
      updateWaiter(token!, branchId, id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: waiterKeys.all(variables.branchId) });
    }
  });
};
