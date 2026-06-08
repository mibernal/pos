import { useEffect, useState, useCallback } from 'react';
import { useSession } from '../features/auth';
import type { PosApiClient } from '../types';

export interface Alert {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  status: 'UNREAD' | 'READ' | 'RESOLVED';
  created_at: string;
}

export function useAlerts(api: PosApiClient) {
  const { session } = useSession();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connected, setConnected] = useState(false);

  const resolveAlert = useCallback(async (id: string, notes?: string) => {
    try {
      await fetch(`${api.baseUrl}/alerts/${id}/resolve`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${session?.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ resolution_notes: notes })
      });
      // Remove or mark as resolved locally
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'RESOLVED' } : a));
    } catch (e) {
      console.error('Failed to resolve alert', e);
    }
  }, [api.baseUrl, session?.accessToken]);

  useEffect(() => {
    // Only connect if user is MANAGER, ADMIN or TENANT_OWNER
    if (!session || !session.user || (session.user.role !== 'ADMIN' && session.user.role !== 'TENANT_OWNER' && session.user.role !== 'MANAGER')) {
      return;
    }

    let active = true;
    const controller = new AbortController();

    async function connectSSE() {
      try {
        const response = await fetch(`${api.baseUrl}/alerts/stream`, {
          headers: {
            'Authorization': `Bearer ${session?.accessToken}`
          },
          signal: controller.signal
        });

        if (!response.ok) throw new Error('SSE failed');
        setConnected(true);

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          let buffer = '';
          while (active) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.substring(6)) as Alert;
                  setAlerts(prev => {
                    // Check if exists
                    if (prev.find(a => a.id === data.id)) return prev;
                    
                    // Trigger sound/toast for CRITICAL
                    if (data.severity === 'CRITICAL') {
                      window.dispatchEvent(new CustomEvent('alert-critical', { detail: data }));
                    }

                    return [data, ...prev].slice(0, 50); // Keep last 50 in memory
                  });
                } catch (e) { // eslint-disable-line @typescript-eslint/no-unused-vars
                  // ignore
                }
              }
            }
          }
        }
      } catch (err) { // eslint-disable-line @typescript-eslint/no-unused-vars
        setConnected(false);
      }
    }

    void connectSSE();

    return () => {
      active = false;
      controller.abort();
    };
  }, [api.baseUrl, session]);

  useEffect(() => {
    setUnreadCount(alerts.filter(a => a.status === 'UNREAD').length);
  }, [alerts]);

  return { alerts, unreadCount, connected, resolveAlert };
}
