import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../auth';
import { deliveryKeys } from '../../../shared/query-keys';
import { 
  CreateDeliveryPayload, 
  DeliveryWithItems, 
  DeliveryWithDetails,
  UpdateDeliveryStatusPayload,
  AssignDeliveryPersonPayload,
  DeliveryPerson,
  CreateDeliveryPersonPayload
} from '@pos-dian/shared';

const getActiveDeliveries = async (token: string, branchId: string): Promise<DeliveryWithDetails[]> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/deliveries`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Failed to fetch deliveries');
  return response.json();
};

const createDelivery = async (token: string, branchId: string, payload: CreateDeliveryPayload): Promise<DeliveryWithItems> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/deliveries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('Failed to create delivery');
  return response.json();
};

const updateDeliveryStatus = async (token: string, branchId: string, id: string, payload: UpdateDeliveryStatusPayload): Promise<DeliveryWithItems> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/deliveries/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('Failed to update delivery status');
  return response.json();
};

const assignDeliveryPerson = async (token: string, branchId: string, id: string, payload: AssignDeliveryPersonPayload): Promise<DeliveryWithItems> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/deliveries/${id}/driver`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('Failed to assign driver');
  return response.json();
};

const getActiveDeliveryPersons = async (token: string, branchId: string): Promise<DeliveryPerson[]> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/delivery-persons`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Failed to fetch delivery persons');
  return response.json();
};

const createDeliveryPerson = async (token: string, branchId: string, payload: CreateDeliveryPersonPayload): Promise<{ id: string }> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/delivery-persons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('Failed to create delivery person');
  return response.json();
};

export const useGetActiveDeliveries = (branchId?: string) => {
  const { token } = useSession();
  return useQuery({
    queryKey: deliveryKeys.all(branchId),
    queryFn: () => getActiveDeliveries(token!, branchId!),
    enabled: !!branchId,
    refetchInterval: 10000 
  });
};

export const useCreateDelivery = () => {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, payload }: { branchId: string; payload: CreateDeliveryPayload }) =>
      createDelivery(token!, branchId, payload),
    onSuccess: (_, { branchId }) => {
      queryClient.invalidateQueries({ queryKey: deliveryKeys.all(branchId) });
    }
  });
};

export const useUpdateDeliveryStatus = () => {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, id, payload }: { branchId: string; id: string; payload: UpdateDeliveryStatusPayload }) =>
      updateDeliveryStatus(token!, branchId, id, payload),
    onSuccess: (_, { branchId }) => {
      queryClient.invalidateQueries({ queryKey: deliveryKeys.all(branchId) });
    }
  });
};

export const useAssignDeliveryPerson = () => {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, id, payload }: { branchId: string; id: string; payload: AssignDeliveryPersonPayload }) =>
      assignDeliveryPerson(token!, branchId, id, payload),
    onSuccess: (_, { branchId }) => {
      queryClient.invalidateQueries({ queryKey: deliveryKeys.all(branchId) });
    }
  });
};

export const useGetActiveDeliveryPersons = (branchId?: string) => {
  const { token } = useSession();
  return useQuery({
    queryKey: deliveryKeys.persons(branchId),
    queryFn: () => getActiveDeliveryPersons(token!, branchId!),
    enabled: !!branchId,
    refetchInterval: 30000 
  });
};

export const useCreateDeliveryPerson = () => {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, payload }: { branchId: string; payload: CreateDeliveryPersonPayload }) =>
      createDeliveryPerson(token!, branchId, payload),
    onSuccess: (_, { branchId }) => {
      queryClient.invalidateQueries({ queryKey: deliveryKeys.persons(branchId) });
    }
  });
};
