import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui';

export function PlatformAlertsWidget({ baseUrl, sessionToken }: { baseUrl: string, sessionToken: string }) {
  const [alerts, setAlerts] = useState<{ severity: string; title: string }[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let es: EventSource;
    try {
      es = new EventSource(`${baseUrl}/platform/alerts/stream?token=${sessionToken}`);
      
      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false);
      
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'INITIAL_ALERTS') {
            setAlerts(data.alerts);
          } else if (data.type === 'NEW_ALERT') {
            setAlerts(prev => [data.alert, ...prev]);
          }
        } catch (e) {
          console.error('Error parsing SSE data', e);
        }
      };
    } catch (err) {
      console.error('SSE connection error', err);
    }

    return () => {
      if (es) {
        es.close();
      }
    };
  }, [baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alerts.length) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-slate-50 border-b border-slate-200 flex flex-row items-center justify-between py-4">
        <CardTitle className="text-base flex items-center gap-2">
          <span>Alertas de Plataforma</span>
          {connected ? (
            <span className="w-2 h-2 rounded-full bg-success-500 inline-block" title="Conectado en tiempo real" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-error-500 inline-block" title="Desconectado" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="flex flex-col gap-2">
          {alerts.map((alert, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${
              alert.severity === 'CRITICAL' ? 'bg-error-50 border-error-200' : 
              alert.severity === 'WARNING' ? 'bg-warning-50 border-warning-200' : 
              'bg-primary-50 border-primary-200'
            }`}>
              <span className="text-xl">{alert.severity === 'CRITICAL' ? '🔴' : alert.severity === 'WARNING' ? '⚠️' : 'ℹ️'}</span>
              <span className="text-sm font-semibold text-slate-800">{alert.title}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
