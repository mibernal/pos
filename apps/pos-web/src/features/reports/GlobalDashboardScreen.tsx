import React, { useEffect, useState } from 'react';
import type { PosApiClient } from '../../types';
// Replaced external UI libraries with standard divs and emojis
const Card = ({ children, className = '' }: any) => <div className={`rounded-xl border bg-card text-card-foreground shadow-sm ${className}`}>{children}</div>;
const CardHeader = ({ children, className = '' }: any) => <div className={`flex flex-col space-y-1.5 p-6 ${className}`}>{children}</div>;
const CardTitle = ({ children, className = '' }: any) => <h3 className={`font-semibold leading-none tracking-tight ${className}`}>{children}</h3>;
const CardContent = ({ children, className = '' }: any) => <div className={`p-6 pt-0 ${className}`}>{children}</div>;
import { useAlerts } from '../../hooks/useAlerts';

export function GlobalDashboardScreen({ api }: { api: PosApiClient }) {
  const [globalData, setGlobalData] = useState<any>(null);
  const [techHealth, setTechHealth] = useState<any>(null);
  const { alerts } = useAlerts(api); // Hook uses SSE

  useEffect(() => {
    async function loadData() {
      try {
        const token = localStorage.getItem('access_token');
        const [globalRes, techRes] = await Promise.all([
          fetch(`${api.baseUrl}/dashboard/global`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${api.baseUrl}/dashboard/tech-health`, { headers: { Authorization: `Bearer ${token}` } })
        ]);
        
        if (globalRes.ok) setGlobalData(await globalRes.json());
        if (techRes.ok) setTechHealth(await techRes.json());
      } catch (e) {
        console.error('Error loading global dashboard', e);
      }
    }
    
    loadData();
    const interval = setInterval(loadData, 60000); // Reload every 1 min
    return () => clearInterval(interval);
  }, [api.baseUrl]);

  if (!globalData || !techHealth) return <div className="p-8 text-center text-gray-500 animate-pulse">Cargando métricas globales...</div>;

  const { kpis, branch_health, top_branches } = globalData;
  const criticalAlerts = alerts.filter(a => a.severity === 'CRITICAL' && a.status === 'UNREAD').slice(0, 5);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Centro de Comando</h1>
          <p className="text-muted-foreground">Vista global de salud operativa y de negocio</p>
        </div>
      </div>

      {/* Row 1: Business KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-emerald-50/50 border-emerald-100">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Ventas de Hoy</CardTitle>
            <span className="text-emerald-600">💵</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-900">
              ${(kpis.global_revenue_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-emerald-600 mt-1">{kpis.global_sales_count} transacciones globales</p>
          </CardContent>
        </Card>

        <Card className="bg-red-50/50 border-red-100">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Devoluciones (Hoy)</CardTitle>
            <span className="text-red-600">❌</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-900">
              ${(kpis.global_voids_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Valor de Bodega</CardTitle>
            <span className="text-gray-500">📦</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(kpis.inventory_valuation_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Salud de Cajas</CardTitle>
            <span className="text-gray-500">📈</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{branch_health.open_sessions_count} Cajas Abiertas</div>
            <p className="text-xs text-muted-foreground mt-1">Descuadre global: ${(branch_health.total_discrepancy_cents / 100).toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Row 2, Col 1-2: Top Branches */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-blue-600">🏆</span> Top Sucursales Hoy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {top_branches.length === 0 && <p className="text-sm text-muted-foreground">No hay ventas registradas hoy.</p>}
              {top_branches.map((b: any, idx: number) => (
                <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <div className="font-medium">{b.name}</div>
                  <div className="text-right">
                    <div className="font-bold">${(b.revenue_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                    <div className="text-xs text-gray-500">{b.sales_count} txns</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Row 2, Col 3: Tech Health */}
        <Card className="bg-slate-900 text-slate-50 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-100">
              <span>⚙️</span> Tech Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-slate-400">Worker Status</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="font-semibold text-green-400">{techHealth.worker.status}</span>
                </div>
              </div>
              <div className="pt-4 border-t border-slate-700">
                <p className="text-sm text-slate-400">Outbox & DIAN Sync</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-slate-300">Encolados (Pending)</span>
                  <span className="font-mono">{techHealth.outbox.pending}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-sm text-slate-300">Estancados (Failed)</span>
                  <span className={`font-mono ${techHealth.outbox.failed > 0 ? 'text-red-400 font-bold' : ''}`}>
                    {techHealth.outbox.failed}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Critical Incidents */}
      {criticalAlerts.length > 0 && (
        <Card className="border-red-200">
          <CardHeader className="bg-red-50/50">
            <CardTitle className="flex items-center gap-2 text-red-700">
              <span>⚠️</span> Alertas Críticas Recientes
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            {criticalAlerts.map(alert => (
              <div key={alert.id} className="p-3 border border-red-100 bg-white rounded-md shadow-sm">
                <div className="flex justify-between items-start">
                  <h4 className="font-semibold text-gray-900">{alert.title}</h4>
                  <span className="text-xs text-gray-500">{new Date(alert.created_at).toLocaleTimeString()}</span>
                </div>
                <p className="text-sm text-gray-700 mt-1">{alert.message}</p>
                <div className="text-xs font-mono text-gray-400 mt-2">ID: {alert.id.split('-')[0]}...</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
