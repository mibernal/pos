import { useCallback, useEffect, useState } from 'react';
import { Banner } from '../../components/ui';
import { formatMoneyFromCents } from '../../lib/format';
import type { PosApiClient } from '../../types';
import type { SalesReportResponse } from '../../lib/api';

import type { TicketTemplateConfig } from '../../lib/ticket-template';
import { printZReportTicket } from '../../lib/ticket-printer';

type DateFilter = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM';

function toStartOfDayIso(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

function toEndOfDayIso(value: string): string {
  return new Date(`${value}T23:59:59.999`).toISOString();
}

export function ReportsScreen({
  api,
  branchId,
  branchName,
  ticketTemplate
}: {
  api: PosApiClient;
  branchId: string;
  branchName: string;
  ticketTemplate: TicketTemplateConfig;
}) {
  const [filter, setFilter] = useState<DateFilter>('TODAY');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [reportData, setReportData] = useState<SalesReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [shiftsData, setShiftsData] = useState<Awaited<ReturnType<PosApiClient['getShiftsReport']>> | null>(null);
  const [activeTab, setActiveTab] = useState<'METRICS' | 'SHIFTS'>('METRICS');

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
        from = customFrom ? toStartOfDayIso(customFrom) : undefined;
        to = customTo ? toEndOfDayIso(customTo) : undefined;
      }

      if (activeTab === 'METRICS') {
        const res = await api.getSalesReport({ branchId, from, to });
        setReportData(res);
      } else {
        const res = await api.getShiftsReport({ branchId, from, to });
        setShiftsData(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar reporte');
    } finally {
      setLoading(false);
    }
  }, [api, branchId, filter, customFrom, customTo, activeTab]);

  useEffect(() => {
    if (filter !== 'CUSTOM') {
      void fetchReport();
    }
  }, [fetchReport, filter, activeTab]);

  return (
    <div className="flex flex-col h-full bg-muted/20 overflow-y-auto animate-in fade-in duration-300">
      <header className="flex-shrink-0 px-6 py-4 border-b border-border bg-background sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Reportes y Analíticas</h2>
          <p className="text-sm text-muted-foreground mt-1">Consulta métricas clave de la sucursal actual</p>
        </div>
      </header>

      <main className="flex-1 p-6 w-full max-w-7xl mx-auto">
        {/* Tabs */}
        <div className="flex gap-2 mb-8 bg-muted/50 p-1.5 rounded-xl w-max border border-border/50">
          <button
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              activeTab === 'METRICS'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
            }`}
            onClick={() => setActiveTab('METRICS')}
          >
            <span className="mr-2">📊</span> Analíticas Generales
          </button>
          <button
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              activeTab === 'SHIFTS'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
            }`}
            onClick={() => setActiveTab('SHIFTS')}
          >
            <span className="mr-2">👤</span> Turnos y Cajeros
          </button>
        </div>

        {/* Filter Controls */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm mb-8">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Periodo</label>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as DateFilter)}
                className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="TODAY">Día de hoy</option>
                <option value="WEEK">Últimos 7 días</option>
                <option value="MONTH">Mes actual</option>
                <option value="CUSTOM">Personalizado</option>
              </select>
            </div>

            {filter === 'CUSTOM' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Desde</label>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Hasta</label>
                  <input
                    type="date"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void fetchReport()}
                  disabled={loading}
                  className="h-10 px-4 inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                >
                  {loading ? 'Consultando...' : 'Aplicar'}
                </button>
              </>
            )}
          </div>
        </div>

        {error && <Banner tone="error" className="mb-6">{error}</Banner>}
        {loading && <Banner tone="info" className="mb-6">Generando reporte...</Banner>}

        {/* Metrics View */}
        {activeTab === 'METRICS' && reportData && !loading && (
          <div className="animate-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
                <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Total Facturado</span>
                <strong className="block text-4xl font-extrabold text-foreground mt-2 tracking-tight">
                  {formatMoneyFromCents(reportData.total_revenue_cents)}
                </strong>
                <p className="mt-2 text-sm text-muted-foreground">Ingresos netos en caja</p>
              </div>

              <div className="bg-card border border-border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
                <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Transacciones</span>
                <strong className="block text-4xl font-extrabold text-foreground mt-2 tracking-tight">
                  {reportData.total_sales_count}
                </strong>
                <p className="mt-2 text-sm text-muted-foreground">Ventas procesadas y completadas</p>
              </div>

              <div className="bg-card border border-border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
                <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Ticket Promedio</span>
                <strong className="block text-4xl font-extrabold text-primary mt-2 tracking-tight">
                  {formatMoneyFromCents(reportData.average_ticket_cents)}
                </strong>
                <p className="mt-2 text-sm text-muted-foreground">Valor promedio de compra</p>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <h3 className="text-lg font-bold text-foreground mb-4">Desglose por Medios de Pago</h3>
              {reportData.revenue_by_method.length === 0 ? (
                <p className="text-muted-foreground text-sm">No hay registros en este periodo.</p>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  {reportData.revenue_by_method.map((item: { method: string; amount_cents: number }, index: number) => (
                    <div 
                      key={item.method} 
                      className={`flex justify-between items-center p-4 ${index !== reportData.revenue_by_method.length - 1 ? 'border-b border-border' : ''} hover:bg-muted/50 transition-colors`}
                    >
                      <strong className="text-foreground font-medium">{item.method}</strong>
                      <span className="font-semibold text-foreground">{formatMoneyFromCents(item.amount_cents)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Shifts View */}
        {activeTab === 'SHIFTS' && shiftsData && !loading && (
          <div className="bg-card border border-border rounded-xl p-6 shadow-sm animate-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-lg font-bold text-foreground mb-4">Historial de Turnos de Caja</h3>
            {shiftsData.items.length === 0 ? (
              <p className="text-muted-foreground text-sm">No hay turnos registrados en este periodo.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {shiftsData.items.map((shift) => (
                  <div key={shift.id} className="p-5 border border-border rounded-lg bg-background hover:border-primary/50 transition-colors shadow-sm">
                    <div className="flex flex-wrap justify-between items-center gap-4 mb-4 pb-4 border-b border-border/50">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                          {shift.user_name.charAt(0).toUpperCase()}
                        </div>
                        <strong className="text-foreground text-lg">{shift.user_name}</strong>
                      </div>
                      <span className={`px-3 py-1 text-xs font-bold rounded-full uppercase tracking-wider ${shift.closed_at ? 'bg-slate-100 text-slate-600' : 'bg-green-100 text-green-700'}`}>
                        {shift.closed_at ? 'CERRADA' : 'ABIERTA'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-sm">
                      <div>
                        <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold mb-1">Apertura</span>
                        <span className="font-medium text-foreground">{new Date(shift.opened_at).toLocaleString('es-CO')}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold mb-1">Base</span>
                        <span className="font-medium text-foreground">{formatMoneyFromCents(shift.opening_amount_cents)}</span>
                      </div>
                      {shift.closed_at && (
                        <>
                          <div>
                            <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold mb-1">Ventas Finales</span>
                            <span className="font-medium text-foreground">{formatMoneyFromCents(shift.expected_cash_cents ?? 0)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold mb-1">Diferencia (Sobrante/Faltante)</span>
                            <strong className={`font-bold ${
                              (shift.diff_cents ?? 0) < 0 ? 'text-destructive' : (shift.diff_cents ?? 0) > 0 ? 'text-green-600' : 'text-foreground'
                            }`}>
                              {formatMoneyFromCents(shift.diff_cents ?? 0)}
                            </strong>
                          </div>
                          <div className="lg:col-span-4 mt-2">
                            <button
                              type="button"
                              className="inline-flex items-center justify-center h-9 px-4 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={async () => {
                                try {
                                  const zData = await api.getZReport(shift.id);
                                  printZReportTicket({
                                    template: ticketTemplate,
                                    branchName,
                                    openedAt: zData.cash_session.opened_at,
                                    closedAt: zData.cash_session.closed_at,
                                    saleCount: zData.summary.completed_sales_count,
                                    totalSalesCents: zData.summary.completed_sales_total_cents,
                                    paymentBreakdown: zData.summary.payment_breakdown,
                                    expectedCashCents: zData.summary.expected_cash_cents,
                                    realCashCents: zData.summary.expected_cash_cents + zData.summary.diff_cents,
                                    diffCents: zData.summary.diff_cents,
                                    status: zData.cash_session.status
                                  });
                                } catch (err) {
                                  alert(err instanceof Error ? err.message : 'Error al obtener reporte Z');
                                }
                              }}
                            >
                              <span className="mr-2">🖨️</span> Imprimir Z
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
