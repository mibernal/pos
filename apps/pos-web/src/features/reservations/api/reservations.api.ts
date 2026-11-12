import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Reservation, CreateReservationPayload, UpdateReservationPayload, UpdateReservationStatusPayload } from '@pos-dian/shared';
import { useApi } from '../../auth';
import { tableKeys } from '../../../shared/query-keys';

export const useReservations = (branchId: string, dateFrom?: string, dateTo?: string) => {
  const api = useApi();
  return useQuery({
    queryKey: tableKeys.reservations(branchId, dateFrom, dateTo),
    queryFn: async (): Promise<Reservation[]> => {
      return api.listReservations(branchId, { dateFrom, dateTo });
    },
    enabled: !!branchId,
    staleTime: 60_000,
  });
};

export const useCreateReservation = (branchId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateReservationPayload): Promise<Reservation> => {
      return api.createReservation(branchId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.reservations(branchId) });
    },
  });
};

export const useUpdateReservation = (branchId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdateReservationPayload }): Promise<Reservation> => {
      return api.updateReservation(branchId, id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.reservations(branchId) });
    },
  });
};

export const useUpdateReservationStatus = (branchId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: UpdateReservationStatusPayload['status'] }): Promise<Reservation> => {
      return api.updateReservationStatus(branchId, id, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.reservations(branchId) });
    },
  });
};
