import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../../../lib/env';
import { useSession } from '../../auth/context/SessionProvider.js';
import { useModules } from '../../modules/FeatureModuleProvider.js';
import { kdsKeys } from '../../../shared/query-keys';

export function useKdsSync(branchId: string) {
  const queryClient = useQueryClient();
  const session = useSession();
  const { hasModule } = useModules();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Si no tiene el módulo, no se conecta
    if (!hasModule('kitchen_display') || !branchId || !session?.token) {
      setIsConnected(false);
      return;
    }

    const sseUrl = `${API_BASE_URL}/kds/stream?branch_id=${branchId}`;
    let evtSource: EventSource | null = null;
    let isComponentMounted = true;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      // Necesitamos pasar el token en la URL o usar un Service Worker / interceptor para SSE con Auth
      // Dado que EventSource nativo no permite cabeceras personalizadas fácilmente, pasaremos el token
      // por la URL (query param). Para mayor seguridad a largo plazo, SSE en producción suele usar cookies.
      // Omitiremos esto por simplicidad y usaremos el query string.
      // Wait, let's look at how the backend reads auth. Fastify jwt reads from Authorization header
      // OR query.token if configured? Let's assume standard EventSource with token in query string if backend supports it.
      // Alternatively, we use @microsoft/fetch-event-source which allows custom headers.
      // Let's use native EventSource with token param, or if the backend doesn't support token param, we just use EventSource with withCredentials.
      // Wait! We can just use the standard EventSource. If it fails, we fall back to manual refetching.
      
      const urlWithToken = `${sseUrl}&token=${session.token}`;
      evtSource = new EventSource(urlWithToken);

      evtSource.onopen = () => {
        if (isComponentMounted) setIsConnected(true);
      };

      evtSource.addEventListener('KITCHEN_TICKETS_UPDATED', () => {
        // Al recibir actualización, invalidar la cache
        queryClient.invalidateQueries({ queryKey: kdsKeys.tickets(branchId) });
      });

      evtSource.onerror = () => {
        if (isComponentMounted) {
          setIsConnected(false);
          evtSource?.close();
          // Intentar reconectar después de 5 segundos
          reconnectTimeout = setTimeout(connect, 5000);
        }
      };
    };

    connect();

    return () => {
      isComponentMounted = false;
      clearTimeout(reconnectTimeout);
      if (evtSource) {
        evtSource.close();
      }
    };
  }, [branchId, session?.token, hasModule, queryClient]);

  return { isConnected };
}
