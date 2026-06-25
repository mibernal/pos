import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiClient } from '../../../lib/api';
import type { Reservation, CreateReservationPayload, UpdateReservationPayload, UpdateReservationStatusPayload } from '@pos-dian/shared';

export const useReservations = (api: ApiClient, branchId: string, dateFrom?: string, dateTo?: string) => {
  return useQuery({
    queryKey: ['reservations', branchId, dateFrom, dateTo],
    queryFn: async (): Promise<Reservation[]> => {
      return api.listReservations(branchId, { dateFrom, dateTo });
    },
    enabled: !!branchId,
    staleTime: 60_000,
  });
};

export const useCreateReservation = (api: ApiClient, branchId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateReservationPayload): Promise<Reservation> => {
      return api.createReservation(branchId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations', branchId] });
    },
  });
};

export const useUpdateReservation = (api: ApiClient, branchId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdateReservationPayload }): Promise<Reservation> => {
      return api.updateReservation(branchId, id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations', branchId] });
    },
  });
};

export const useUpdateReservationStatus = (api: ApiClient, branchId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: UpdateReservationStatusPayload['status'] }): Promise<Reservation> => {
      return api.updateReservationStatus(branchId, id, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations', branchId] });
    },
  });
};
