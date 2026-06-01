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
  }, [api.baseUrl, branchId]);

  return (
    <div className="pos-screen" style={{ flexDirection: 'column', overflowY: 'auto' }}>
      <header className="section-heading" style={{ padding: '1rem', borderBottom: '1px solid var(--color-slate-200)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div>
            <h2>Dashboard en Tiempo Real</h2>
            <p>Métricas de ventas al instante</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: connected ? 'var(--color-success-500)' : 'var(--color-error-500)', boxShadow: connected ? '0 0 8px var(--color-success-500)' : 'none' }}></div>
            <span style={{ fontSize: '0.875rem', color: 'var(--color-slate-500)' }}>
              {connected ? 'Conectado (Live)' : 'Desconectado'}
            </span>
          </div>
        </div>
      </header>

      <div style={{ padding: '1.5rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        {error && <Banner tone="error">{error}</Banner>}

        {!stats && !error && <Banner tone="info">Conectando al stream en vivo...</Banner>}

        {stats && (
          <div className="stack-lg">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
              <div className="metric-card" style={{ background: '#ffffff', border: '1px solid var(--color-slate-200)', borderRadius: '12px', padding: '1.5rem', boxShadow: 'var(--shadow-sm)' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-slate-500)', fontWeight: 600 }}>Ventas de Hoy</span>
                <strong style={{ display: 'block', fontSize: '2.5rem', color: 'var(--color-slate-900)', marginTop: '0.5rem' }}>
                  {formatMoneyFromCents(stats.total_revenue_cents)}
                </strong>
                <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-slate-400)' }}>Total facturado hoy</p>
              </div>

              <div className="metric-card" style={{ background: '#ffffff', border: '1px solid var(--color-slate-200)', borderRadius: '12px', padding: '1.5rem', boxShadow: 'var(--shadow-sm)' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-slate-500)', fontWeight: 600 }}>Transacciones</span>
                <strong style={{ display: 'block', fontSize: '2.5rem', color: 'var(--color-slate-900)', marginTop: '0.5rem' }}>
                  {stats.total_sales_count}
                </strong>
                <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-slate-400)' }}>Operaciones exitosas</p>
              </div>

              <div className="metric-card" style={{ background: '#ffffff', border: '1px solid var(--color-slate-200)', borderRadius: '12px', padding: '1.5rem', boxShadow: 'var(--shadow-sm)' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-slate-500)', fontWeight: 600 }}>Valor del Inventario</span>
                <strong style={{ display: 'block', fontSize: '2.5rem', color: 'var(--color-slate-900)', marginTop: '0.5rem' }}>
                  {formatMoneyFromCents(stats.total_inventory_value_cents)}
                </strong>
                <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-slate-400)' }}>Capital en bodega</p>
              </div>
            </div>

            <div className="form-card" style={{ marginTop: '2rem' }}>
              <h3>Ventas por Hora</h3>
              <div style={{ height: '300px', marginTop: '1.5rem' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.chart_data}>
                    <defs>
                      <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-primary-500)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-primary-500)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-slate-100)" />
                    <XAxis
                      dataKey="hour"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--color-slate-400)', fontSize: 12 }}
                      dy={10}
                    />
                    <YAxis
                      tickFormatter={(value) => `$${(value / 100).toLocaleString()}`}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--color-slate-400)', fontSize: 12 }}
                      dx={-10}
                    />
                    <Tooltip
                      formatter={(value: unknown) => [formatMoneyFromCents(Number(value as string | number) || 0), 'Total']}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: 'var(--shadow-md)' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="amount_cents"
                      stroke="var(--color-primary-500)"
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
      </div>
    </div>
  );
}
