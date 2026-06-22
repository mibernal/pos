import { useEffect, useState } from 'react';
import { Banner } from '../../components/ui';
import { formatMoneyFromCents } from '../../lib/format';
import type { PosApiClient } from '../../types';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useSession } from '../auth';

interface DashboardStats {
  total_revenue_cents: number;
  total_sales_count: number;
  total_inventory_value_cents: number;
  chart_data: Array<{ hour: string; amount_cents: number }>;
}

export function DashboardScreen({
  api,
  branchId
}: {
  api: PosApiClient;
  branchId: string;
}) {
  const { session } = useSession();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function connectSSE() {
      try {
        const response = await fetch(`${api.baseUrl}/dashboard/stream?branch_id=${branchId}`, {
          headers: {
            'Authorization': `Bearer ${session?.accessToken}`
          },
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error('No fue posible conectar al stream en vivo');
        }

        setConnected(true);
        setError(null);

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          let buffer = '';
          while (active) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep the last incomplete line

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.substring(6)) as DashboardStats;
                  setStats(data);
                } catch (e) {
                  console.error('Failed to parse SSE data', e);
                }
              }
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err.message || 'Error de conexión');
          setConnected(false);
        }
      }
    }

    void connectSSE();

    return () => {
      active = false;
      controller.abort();
    };
  }, [api.baseUrl, branchId, session?.accessToken]);

  return (
    <div className="flex flex-col h-full bg-muted/20 overflow-y-auto animate-in fade-in duration-300">
      <header className="flex-shrink-0 px-6 py-4 border-b border-border bg-background sticky top-0 z-10 shadow-sm">
        <div className="flex justify-between items-center w-full max-w-7xl mx-auto">
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">Dashboard en Tiempo Real</h2>
            <p className="text-sm text-muted-foreground mt-1">Métricas de ventas al instante</p>
          </div>
          <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-full border border-border/50">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse' : 'bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`}></div>
            <span className="text-sm font-medium text-muted-foreground">
              {connected ? 'Conectado (Live)' : 'Desconectado'}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 w-full max-w-7xl mx-auto">
        {error && <Banner tone="error" className="mb-6">{error}</Banner>}
        {!stats && !error && <Banner tone="info" className="mb-6">Conectando al stream en vivo...</Banner>}

        {stats && (
          <div className="flex flex-col gap-8 animate-in slide-in-from-bottom-4 duration-500">
            {/* Metric Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Card 1 */}
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
                <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Ventas de Hoy</span>
                <strong className="block text-4xl font-extrabold text-foreground mt-2 tracking-tight">
                  {formatMoneyFromCents(stats.total_revenue_cents)}
                </strong>
                <p className="mt-2 text-sm text-muted-foreground">Total facturado hoy</p>
              </div>

              {/* Card 2 */}
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
                <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Transacciones</span>
                <strong className="block text-4xl font-extrabold text-foreground mt-2 tracking-tight">
                  {stats.total_sales_count}
                </strong>
                <p className="mt-2 text-sm text-muted-foreground">Operaciones exitosas</p>
              </div>

              {/* Card 3 */}
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
                <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Valor del Inventario</span>
                <strong className="block text-4xl font-extrabold text-foreground mt-2 tracking-tight">
                  {formatMoneyFromCents(stats.total_inventory_value_cents)}
                </strong>
                <p className="mt-2 text-sm text-muted-foreground">Capital en bodega</p>
              </div>
            </div>

            {/* Chart Area */}
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <div className="mb-6">
                <h3 className="text-lg font-bold text-foreground">Ventas por Hora</h3>
                <p className="text-sm text-muted-foreground">Evolución de ingresos en la jornada actual</p>
              </div>
              <div className="h-[350px] w-full" style={{ minWidth: 0, minHeight: 350 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.chart_data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
                    <XAxis
                      dataKey="hour"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12, fontWeight: 500 }}
                      dy={15}
                    />
                    <YAxis
                      tickFormatter={(value) => `$${(value / 100).toLocaleString('es-CO')}`}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12, fontWeight: 500 }}
                      dx={-15}
                    />
                    <Tooltip
                      formatter={(value: unknown) => [formatMoneyFromCents(Number(value as string | number) || 0), 'Total']}
                      contentStyle={{ 
                        borderRadius: '0.75rem', 
                        border: '1px solid hsl(var(--border))', 
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', 
                        backgroundColor: 'hsl(var(--card))',
                        color: 'hsl(var(--card-foreground))'
                      }}
                      itemStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="amount_cents"
                      stroke="hsl(var(--primary))"
                      strokeWidth={3}
                      fillOpacity={1}
                      fill="url(#colorAmount)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
