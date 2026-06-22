import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../auth/context/SessionProvider';
import type { KitchenTicketWithItems } from '@pos-dian/shared';

const getActiveTickets = async (token: string, branchId: string): Promise<KitchenTicketWithItems[]> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/kds/tickets`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Failed to fetch active tickets');
  return response.json();
};

const updateTicketStatus = async (token: string, branchId: string, id: string, status: string): Promise<void> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/kds/tickets/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status })
  });
  if (!response.ok) throw new Error('Failed to update ticket status');
};

export const useGetActiveTickets = (branchId: string) => {
  const { token } = useSession();
  return useQuery({
    queryKey: ['kds-tickets', branchId],
    queryFn: () => getActiveTickets(token!, branchId),
    enabled: !!token && !!branchId,
  });
};

export const useUpdateTicketStatus = () => {
  const queryClient = useQueryClient();
  const { token } = useSession();

  return useMutation({
    mutationFn: ({ branchId, id, status }: { branchId: string; id: string; status: string }) => 
      updateTicketStatus(token!, branchId, id, status),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['kds-tickets', variables.branchId] });
    }
  });
};
