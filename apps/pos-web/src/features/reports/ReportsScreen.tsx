import { useCallback, useEffect, useState } from 'react';
import { Banner } from '../../components/ui';
import { formatMoneyFromCents } from '../../lib/format';
import type { PosApiClient } from '../../types';
import type { SalesReportResponse } from '../../lib/api';

type DateFilter = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM';

export function ReportsScreen({
  api,
  branchId
}: {
  api: PosApiClient;
  branchId: string;
}) {
  const [filter, setFilter] = useState<DateFilter>('TODAY');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  
  const [reportData, setReportData] = useState<SalesReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let from: string | undefined;
      let to: string | undefined;

      const now = new Date();
      
      if (filter === 'TODAY') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        from = start.toISOString();
      } else if (filter === 'WEEK') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        start.setDate(now.getDate() - 7);
        from = start.toISOString();
      } else if (filter === 'MONTH') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        from = start.toISOString();
      } else if (filter === 'CUSTOM') {
        from = customFrom ? new Date(customFrom).toISOString() : undefined;
        to = customTo ? new Date(customTo).toISOString() : undefined;
      }

      const res = await api.getSalesReport({ branchId, from, to });
      setReportData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar reporte');
    } finally {
      setLoading(false);
    }
  }, [api, branchId, filter, customFrom, customTo]);

  useEffect(() => {
    if (filter !== 'CUSTOM') {
      void fetchReport();
    }
  }, [fetchReport, filter]);

  return (
    <div className="pos-screen" style={{ flexDirection: 'column', overflowY: 'auto' }}>
      <header className="section-heading" style={{ padding: '1rem', borderBottom: '1px solid var(--color-slate-200)', flexShrink: 0 }}>
        <div>
          <h2>Reportes y Analíticas</h2>
          <p>Consulta métricas clave de la sucursal actual</p>
        </div>
      </header>
      
      <div style={{ padding: '1.5rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        <div className="form-card" style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="field">
              <span>Periodo</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value as DateFilter)}>
                <option value="TODAY">Día de hoy</option>
                <option value="WEEK">Últimos 7 días</option>
                <option value="MONTH">Mes actual</option>
                <option value="CUSTOM">Personalizado</option>
              </select>
            </label>
            
            {filter === 'CUSTOM' && (
              <>
                <label className="field">
                  <span>Desde</span>
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
                </label>
                <label className="field">
                  <span>Hasta</span>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
                </label>
                <button type="button" className="ghost-button" onClick={() => void fetchReport()} disabled={loading}>
                  {loading ? 'Consultando...' : 'Aplicar'}
                </button>
              </>
            )}
          </div>
        </div>

        {error && <Banner tone="error">{error}</Banner>}
        {loading && !reportData && <Banner tone="info">Generando reporte...</Banner>}

        {reportData && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
              <div className="metric-card" style={{ background: '#ffffff', border: '1px solid var(--color-slate-200)', borderRadius: '12px', padding: '1.5rem', boxShadow: 'var(--shadow-sm)' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-slate-500)', fontWeight: 600 }}>Total Facturado</span>
                <strong style={{ display: 'block', fontSize: '2rem', color: 'var(--color-slate-900)', marginTop: '0.5rem' }}>
                  {formatMoneyFromCents(reportData.total_revenue_cents)}
                </strong>
                <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-slate-400)' }}>Ingresos netos en caja</p>
              </div>

              <div className="metric-card" style={{ background: '#ffffff', border: '1px solid var(--color-slate-200)', borderRadius: '12px', padding: '1.5rem', boxShadow: 'var(--shadow-sm)' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-slate-500)', fontWeight: 600 }}>Transacciones</span>
                <strong style={{ display: 'block', fontSize: '2rem', color: 'var(--color-slate-900)', marginTop: '0.5rem' }}>
                  {reportData.total_sales_count}
                </strong>
                <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-slate-400)' }}>Ventas procesadas y completadas</p>
              </div>

              <div className="metric-card" style={{ background: '#ffffff', border: '1px solid var(--color-slate-200)', borderRadius: '12px', padding: '1.5rem', boxShadow: 'var(--shadow-sm)' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-slate-500)', fontWeight: 600 }}>Ticket Promedio</span>
                <strong style={{ display: 'block', fontSize: '2rem', color: 'var(--color-primary-600)', marginTop: '0.5rem' }}>
                  {formatMoneyFromCents(reportData.average_ticket_cents)}
                </strong>
                <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-slate-400)' }}>Valor promedio de compra</p>
              </div>
            </div>

            <div className="form-card">
              <h3>Desglose por Medios de Pago</h3>
              {reportData.revenue_by_method.length === 0 ? (
                <p style={{ color: 'var(--color-slate-400)', marginTop: '1rem' }}>No hay registros en este periodo.</p>
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  {reportData.revenue_by_method.map((item: { method: string; amount_cents: number }) => (
                    <div key={item.method} style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', borderBottom: '1px solid var(--color-slate-100)' }}>
                      <strong style={{ color: 'var(--color-slate-700)' }}>{item.method}</strong>
                      <span style={{ fontWeight: 600 }}>{formatMoneyFromCents(item.amount_cents)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
