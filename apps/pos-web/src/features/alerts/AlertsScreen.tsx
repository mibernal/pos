import React, { useEffect, useState } from 'react';
import { useAlerts } from '../../hooks/useAlerts';
import { Button } from '../../components/ui';
import { AlertTriangle, Info, XCircle, CheckCircle2 } from 'lucide-react';
import { useApi } from '../auth';

interface AlertItem {
  id: string;
  severity: string;
  title: string;
  message: string;
  created_at: string;
  type: string;
  branch_id?: string;
  status: string;
}

export function AlertsScreen() {
  const api = useApi();
  const { alerts, resolveAlert } = useAlerts();
  // Realistically we would fetch historical alerts from /alerts endpoint,
  // but for simplicity we rely on the in-memory array provided by useAlerts for active ones.
  const [history, setHistory] = useState<AlertItem[]>([]);

  useEffect(() => {
    async function loadHistory() {
      try {
        const token = localStorage.getItem('access_token'); // Or get from session
        const res = await fetch(`${api.baseUrl}/alerts?limit=100`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        setHistory(data.items || []);
      } catch (e) {
        console.error(e);
      }
    }
    loadHistory();
  }, [api.baseUrl, alerts]); // reload history if alerts change

  const renderIcon = (severity: string) => {
    switch(severity) {
      case 'CRITICAL': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'WARNING': return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      default: return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Centro de Alertas</h1>
          <p className="text-muted-foreground">Gestión de incidentes operativos</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border shadow-sm">
        <div className="divide-y">
          {history.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              No hay alertas registradas.
            </div>
          )}
          {history.map((alert: AlertItem) => (
            <div key={alert.id} className={`p-4 flex gap-4 ${alert.status === 'UNREAD' ? 'bg-blue-50/30' : ''}`}>
              <div className="mt-1">{renderIcon(alert.severity)}</div>
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <h3 className="font-semibold text-gray-900">{alert.title}</h3>
                  <span className="text-xs text-gray-500">{new Date(alert.created_at).toLocaleString()}</span>
                </div>
                <p className="text-sm text-gray-600 mt-1">{alert.message}</p>
                <div className="mt-2 text-xs font-mono text-gray-400 bg-gray-50 p-2 rounded">
                  {alert.type} • Sucursal: {alert.branch_id || 'Global'}
                </div>
              </div>
              <div className="flex items-center">
                {alert.status !== 'RESOLVED' ? (
                  <Button variant="outline" size="sm" onClick={() => resolveAlert(alert.id)}>
                    <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" />
                    Resolver
                  </Button>
                ) : (
                  <span className="text-sm text-gray-400 bg-gray-100 px-3 py-1 rounded-full">Resuelta</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
