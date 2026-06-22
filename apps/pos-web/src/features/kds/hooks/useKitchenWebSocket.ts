import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../auth';
import { useModules } from '../../modules';

export const useKitchenWebSocket = (branchId?: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();
  const { token } = useSession();
  const { hasModule } = useModules();

  useEffect(() => {
    if (!branchId || !token) return;
    if (!hasModule('kitchen_display') && !hasModule('qr_menu')) return;

    // Connect to the root but pass the branchId in the query to join the room
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const socket: Socket = io(apiUrl, {
      query: { branchId },
      auth: { token: token },
      transports: ['websocket', 'polling'], // Prefer WS but fallback to polling
      withCredentials: true
    });

    socket.on('connect', () => {
      setIsConnected(true);
      console.log(`[WS] Connected to kitchen updates for branch ${branchId}`);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log(`[WS] Disconnected from kitchen updates`);
    });

    socket.on('KITCHEN_TICKETS_UPDATED', () => {
      console.log(`[WS] KITCHEN_TICKETS_UPDATED received - invalidating query`);
      queryClient.invalidateQueries({ queryKey: ['kds-tickets', branchId] });
    });

    return () => {
      socket.disconnect();
    };
  }, [branchId, queryClient, token]);

  return { isConnected };
};
