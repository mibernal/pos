import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../auth';
import { RoomWithTables, CreateRoomPayload, CreateTablePayload, UpdateTableStatusPayload, Table, Room, TableOrderWithItems, SaveTableOrderPayload, TransferTablePayload, TableOrderItem } from '@pos-dian/shared';
import { kdsKeys, tableKeys } from '../../../shared/query-keys';

const getRoomsWithTables = async (token: string, branchId: string): Promise<RoomWithTables[]> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/rooms`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Failed to fetch rooms');
  return response.json();
};

const createRoom = async (token: string, branchId: string, payload: CreateRoomPayload): Promise<Room> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('Failed to create room');
  return response.json();
};

const createTable = async (token: string, branchId: string, roomId: string, payload: CreateTablePayload): Promise<Table> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/rooms/${roomId}/tables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('Failed to create table');
  return response.json();
};

const updateTableStatus = async (token: string, branchId: string, tableId: string, payload: UpdateTableStatusPayload): Promise<Table> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/tables/${tableId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('Failed to update table status');
  return response.json();
};

const getTableOrder = async (token: string, branchId: string, tableId: string): Promise<TableOrderWithItems | null> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/tables/${tableId}/order`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Failed to fetch table order');
  return response.json();
};

const saveTableOrder = async (token: string, branchId: string, tableId: string, payload: SaveTableOrderPayload): Promise<TableOrderWithItems> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/tables/${tableId}/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('Failed to save table order');
  return response.json();
};

const clearTableOrder = async (token: string, branchId: string, tableId: string): Promise<void> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/tables/${tableId}/order`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Failed to clear table order');
};

const transferTableOrder = async (token: string, branchId: string, tableId: string, payload: TransferTablePayload): Promise<{ success: boolean }> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/tables/${tableId}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('Failed to transfer table order');
  return response.json();
};

const sendTableOrderToKitchen = async (token: string, branchId: string, tableId: string): Promise<{ order: TableOrderWithItems['order'], itemsSent: TableOrderItem[] }> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/tables/${tableId}/orders/kitchen-print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({})
  });
  if (!response.ok) throw new Error('Failed to send order to kitchen');
  return response.json();
};

const fireKitchenCourse = async (token: string, branchId: string, tableId: string, course?: number): Promise<{ success: boolean }> => {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/branches/${branchId}/tables/${tableId}/orders/kitchen-fire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(course ? { course } : {})
  });
  if (!response.ok) throw new Error('Failed to fire kitchen course');
  return response.json();
};

export const useGetRooms = (branchId?: string) => {
  const { token } = useSession();
  return useQuery({
    queryKey: tableKeys.rooms(branchId),
    queryFn: () => getRoomsWithTables(token!, branchId!),
    enabled: !!branchId,
    // Polling is completely disabled because we use WebSockets (Socket.io) now
    staleTime: 15_000,                  // Data considered fresh for 15s (avoids refetch on mount if coming from cache)
    retry: 1                            // Only retry once to avoid spamming the server
  });
};

export const useCreateRoom = () => {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, payload }: { branchId: string; payload: CreateRoomPayload }) =>
      createRoom(token!, branchId, payload),
    onSuccess: (_, { branchId }) => {
      queryClient.invalidateQueries({ queryKey: tableKeys.rooms(branchId) });
    }
  });
};

export const useCreateTable = () => {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, roomId, payload }: { branchId: string; roomId: string; payload: CreateTablePayload }) =>
      createTable(token!, branchId, roomId, payload),
    onSuccess: (_, { branchId }) => {
      queryClient.invalidateQueries({ queryKey: tableKeys.rooms(branchId) });
    }
  });
};

export const useUpdateTableStatus = () => {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, tableId, payload }: { branchId: string; tableId: string; payload: UpdateTableStatusPayload }) =>
      updateTableStatus(token!, branchId, tableId, payload),
    onSuccess: (_, { branchId }) => {
      queryClient.invalidateQueries({ queryKey: tableKeys.rooms(branchId) });
    }
  });
};

export const useGetTableOrder = (branchId?: string, tableId?: string) => {
  const { token } = useSession();
  return useQuery({
    queryKey: tableKeys.order(branchId, tableId),
    queryFn: () => getTableOrder(token!, branchId!, tableId!),
    enabled: !!branchId && !!tableId,
    staleTime: 30_000
  });
};

export const useSaveTableOrder = () => {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, tableId, payload }: { branchId: string; tableId: string; payload: SaveTableOrderPayload }) =>
      saveTableOrder(token!, branchId, tableId, payload),
    onSuccess: (data, { branchId, tableId }) => {
      queryClient.setQueryData(tableKeys.order(branchId, tableId), data);
      queryClient.invalidateQueries({ queryKey: tableKeys.order(branchId, tableId) });
      queryClient.invalidateQueries({ queryKey: tableKeys.rooms(branchId) });
    }
  });
};

export const useClearTableOrder = () => {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, tableId }: { branchId: string; tableId: string }) =>
      clearTableOrder(token!, branchId, tableId),
    onSuccess: (_, { branchId, tableId }) => {
      // Optimistically clear the table order data
      queryClient.setQueryData(tableKeys.order(branchId, tableId), null);
      
      // Optimistically update the table status in the rooms cache
      queryClient.setQueryData(tableKeys.rooms(branchId), (oldData: RoomWithTables[] | undefined) => {
        if (!oldData) return oldData;
        return oldData.map(room => ({
          ...room,
          tables: room.tables.map(table => {
            if (table.id === tableId) {
              return { ...table, status: 'AVAILABLE', currentOrderId: null };
            }
            return table;
          })
        }));
      });
      
      queryClient.invalidateQueries({ queryKey: tableKeys.order(branchId, tableId) });
      queryClient.invalidateQueries({ queryKey: tableKeys.rooms(branchId) });
    }
  });
};

export const useTransferTableOrder = () => {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, tableId, payload }: { branchId: string; tableId: string; payload: TransferTablePayload }) =>
      transferTableOrder(token!, branchId, tableId, payload),
    onSuccess: (_, { branchId, tableId, payload }) => {
      queryClient.invalidateQueries({ queryKey: tableKeys.order(branchId, tableId) });
      queryClient.invalidateQueries({ queryKey: tableKeys.order(branchId, payload.destinationTableId) });
      queryClient.invalidateQueries({ queryKey: tableKeys.rooms(branchId) });
    }
  });
};

export const useSendTableOrderToKitchen = () => {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, tableId }: { branchId: string; tableId: string }) =>
      sendTableOrderToKitchen(token!, branchId, tableId),
    onSuccess: (_, { branchId, tableId }) => {
      queryClient.invalidateQueries({ queryKey: tableKeys.order(branchId, tableId) });
    }
  });
};

export const useFireKitchenCourse = () => {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, tableId, course }: { branchId: string; tableId: string; course?: number }) =>
      fireKitchenCourse(token!, branchId, tableId, course),
    onSuccess: (_, { branchId }) => {
      queryClient.invalidateQueries({ queryKey: kdsKeys.tickets(branchId) });
    }
  });
};
