import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../auth/context/SessionProvider';
import { useModules } from '../../modules';
import { tableKeys } from '../../../shared/query-keys';

export const useTablesWebSocket = (branchId?: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();
  const { token } = useSession();
  const { hasModule } = useModules();

  useEffect(() => {
    if (!branchId || !token) return;
    if (!hasModule('tables')) return;

    // Conectar a la raíz pero pasando el branchId en el query para unirnos a la sala
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const socket: Socket = io(apiUrl, {
      query: { branchId },
      auth: { token },
      transports: ['websocket', 'polling'], // Prefer WS but fallback to polling
      withCredentials: true
    });

    socket.on('connect', () => {
      setIsConnected(true);
      console.log(`[WS] Connected to table updates for branch ${branchId}`);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log(`[WS] Disconnected from table updates`);
    });

    socket.on('TABLES_UPDATED', () => {
      console.log(`[WS] TABLES_UPDATED received - invalidating query`);
      // Invalida la caché para forzar un refetch de los rooms en background
      queryClient.invalidateQueries({ queryKey: tableKeys.rooms(branchId) });
    });

    return () => {
      socket.disconnect();
    };
  }, [branchId, queryClient, token]);

  return { isConnected };
};
