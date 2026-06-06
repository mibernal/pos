import React, { useEffect, useState } from 'react';

export function PlatformAlertsWidget({ baseUrl, sessionToken }: { baseUrl: string, sessionToken: string }) {
  const [alerts, setAlerts] = useState<any[]>([]);
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
  }, [baseUrl]);

  if (!alerts.length) return null;

  return (
    <div style={{ background: '#ffffff', borderRadius: '1.25rem', border: '1px solid var(--color-slate-200)', boxShadow: 'var(--shadow-sm)', marginBottom: '2rem', overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.5rem', background: 'var(--color-slate-50)', borderBottom: '1px solid var(--color-slate-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-slate-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>Alertas de Plataforma</span>
          {connected ? (
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-success-500)', display: 'inline-block' }} title="Conectado en tiempo real" />
          ) : (
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-error-500)', display: 'inline-block' }} title="Desconectado" />
          )}
        </h2>
      </div>
      <div style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {alerts.map((alert, i) => (
            <div key={i} style={{ 
              display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', borderRadius: '0.5rem', 
              background: alert.severity === 'CRITICAL' ? 'var(--color-error-50)' : alert.severity === 'WARNING' ? 'var(--color-warning-50)' : 'var(--color-primary-50)',
              border: `1px solid ${alert.severity === 'CRITICAL' ? 'var(--color-error-200)' : alert.severity === 'WARNING' ? 'var(--color-warning-200)' : 'var(--color-primary-200)'}`
            }}>
              <span style={{ fontSize: '1.25rem' }}>{alert.severity === 'CRITICAL' ? '🔴' : alert.severity === 'WARNING' ? '⚠️' : 'ℹ️'}</span>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-slate-800)' }}>{alert.title}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
