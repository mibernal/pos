import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../auth/context/SessionProvider';
import type { Waiter, CreateWaiterPayload, UpdateWaiterPayload } from '@pos-dian/shared';

const getWaiters = async (token: string, branchId: string): Promise<Waiter[]> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/waiters`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Failed to fetch waiters');
  return response.json();
};

const createWaiter = async (token: string, branchId: string, payload: CreateWaiterPayload): Promise<Waiter> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/waiters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('Failed to create waiter');
  return response.json();
};

const updateWaiter = async (token: string, branchId: string, id: string, payload: UpdateWaiterPayload): Promise<Waiter> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/waiters/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('Failed to update waiter');
  return response.json();
};

export const useGetWaiters = (branchId: string) => {
  const { token } = useSession();
  return useQuery({
    queryKey: ['waiters', branchId],
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
      queryClient.invalidateQueries({ queryKey: ['waiters', variables.branchId] });
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
      queryClient.invalidateQueries({ queryKey: ['waiters', variables.branchId] });
    }
  });
};
