import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, Modal, PlaceholderImage } from '../../components/ui';
import { formatMoneyFromCents, statusClassName, dianStatusLabel, toDateInputValue } from '../../lib/format';
import { extractTicketPayments, printSaleTicket } from '../../lib/ticket-printer';
import type { SaleDetailResponse, SalesListItem, TenantTaxMode } from '../../lib/api';
import type { TicketTemplateConfig } from '../../lib/ticket-template';
import type { PosApiClient } from '../../types';
import { PermissionGuard, useSession } from '../auth';
import { inferTaxModeFromSale } from '../sales';
import { ReturnSaleModal } from './components/ReturnSaleModal';

function paymentMethodLabel(method: 'CASH' | 'CARD' | 'TRANSFER'): string {
  if (method === 'CASH') {
    return 'Efectivo';
  }

  if (method === 'CARD') {
    return 'Tarjeta';
  }

  return 'Transferencia';
}

function paymentModeLabel(mode: SalesListItem['payment_json']['mode']): string {
  if (mode === 'MIXED') {
    return 'Mixto';
  }

  return paymentMethodLabel(mode);
}

function formatSaleDateTime(value: string): { date: string; time: string } {
  const date = new Date(value);

  return {
    date: date.toLocaleDateString('es-CO'),
    time: date.toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit'
    })
  };
}

export function HistoryScreen({
  api,
  branchId,
  branchName,
  branchAddress,
  ticketTemplate,
  tenantTaxMode
}: {
  api: PosApiClient;
  branchId: string;
  branchName: string;
  branchAddress?: string;
  ticketTemplate: TicketTemplateConfig;
  tenantTaxMode?: TenantTaxMode | null;
}) {
  const { role, user } = useSession();
  const [fromDate, setFromDate] = useState(() => {
    const from = new Date();
    from.setDate(from.getDate() - 7);
    return toDateInputValue(from);
  });
  const [toDate, setToDate] = useState(() => toDateInputValue(new Date()));
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sales, setSales] = useState<SalesListItem[]>([]);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedSaleDetail, setSelectedSaleDetail] = useState<SaleDetailResponse | null>(null);
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidLoading, setVoidLoading] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);

  const listedTotalCents = useMemo(
    () => sales.reduce((sum, sale) => sum + sale.total_cents, 0),
    [sales]
  );
  const selectedSale = useMemo(
    () => sales.find((sale) => sale.id === selectedSaleId) ?? null,
    [sales, selectedSaleId]
  );
  const selectedSalePayments = useMemo(
    () => (selectedSaleDetail ? extractTicketPayments(selectedSaleDetail.sale.payment_json) : []),
    [selectedSaleDetail]
  );


  const loadSaleDetail = useCallback(
    async (saleId: string) => {
      setSelectedSaleId(saleId);
      setDetailLoading(true);
      setDetailError(null);

      try {
        const detail = await api.getSale(saleId);
        setSelectedSaleDetail(detail);
      } catch (loadError) {
        setDetailError(
          loadError instanceof Error ? loadError.message : 'No fue posible cargar el detalle de venta'
        );
        setSelectedSaleDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [api]
  );

  const loadSales = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.listSales({
        branchId,
        from: fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined,
        to: toDate ? new Date(`${toDate}T23:59:59`).toISOString() : undefined,
        limit
      });

      setSales(response.items);

      const nextSelectedSaleId =
        response.items.find((sale) => sale.id === selectedSaleId)?.id ?? response.items[0]?.id ?? null;

      if (!nextSelectedSaleId) {
        setSelectedSaleId(null);
        setSelectedSaleDetail(null);
        return;
      }

      await loadSaleDetail(nextSelectedSaleId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No fue posible cargar ventas');
    } finally {
      setLoading(false);
    }
  }, [api, branchId, fromDate, limit, loadSaleDetail, selectedSaleId, toDate]);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  function openVoidModal() {
    if (!selectedSale || selectedSale.status === 'VOID' || (role !== 'ADMIN' && role !== 'TENANT_OWNER' && !user?.permissions?.includes('sales:void'))) {
      return;
    }

    setVoidReason('');
    setDetailError(null);
    setIsVoidModalOpen(true);
  }

  function closeVoidModal() {
    if (voidLoading) {
      return;
    }

    setIsVoidModalOpen(false);
    setVoidReason('');
  }

  async function handleVoidSale() {
    if (!selectedSale || selectedSale.status === 'VOID' || (role !== 'ADMIN' && role !== 'TENANT_OWNER' && !user?.permissions?.includes('sales:void'))) {
      return;
    }

    const normalizedReason = voidReason.trim();
    if (normalizedReason.length < 3) {
      return;
    }

    setVoidLoading(true);
    setDetailError(null);

    try {
      await api.voidSale(selectedSale.id, {
        void_reason: normalizedReason
      });
      setIsVoidModalOpen(false);
      setVoidReason('');
      await loadSales();
    } catch (voidError) {
      setDetailError(
        voidError instanceof Error ? voidError.message : 'No fue posible anular la venta'
      );
    } finally {
      setVoidLoading(false);
    }
  }

  function handlePrint() {
    if (!selectedSaleDetail) {
      return;
    }

    const sale = selectedSaleDetail.sale;
    printSaleTicket({
      template: ticketTemplate,
      branchName,
      branchAddress,
      saleNumber: sale.sale_number,
      createdAt: sale.created_at,
      saleStatus: sale.status,
      items: selectedSaleDetail.items.map((item) => ({
        name: item.product_name,
        qty: item.qty,
        priceCents: item.price_cents,
        lineTotalCents: item.line_total_cents
      })),
      subtotalCents: sale.subtotal_cents,
      discountCents: sale.discount_cents,
      totalCents: sale.total_cents,
      payments: selectedSalePayments,
      taxMode: tenantTaxMode ?? inferTaxModeFromSale(sale),
      dianStatus: selectedSaleDetail.dian_document?.status ?? sale.dian_status ?? 'PENDING',
      cude: selectedSaleDetail.dian_document?.cude ?? null,
      voidReason: sale.void_reason,
      voidedAt: sale.voided_at
    });
  }

  return (
    <div className="history-layout">
      <section className="history-list">
        <header className="section-heading">
          <div className="heading-copy">
            <h2>Historial de Ventas</h2>
            <p>Monitorea y audita las transacciones de esta sucursal</p>
          </div>
          <button className="ghost-button" style={{ padding: '0.5rem 1rem' }} onClick={() => void loadSales()}>
            🔄 Actualizar
          </button>
        </header>

        <div className="history-summary" style={{ marginBottom: '2rem' }}>
          <div className="metric-card">
            <span>Transacciones</span>
            <strong>{sales.length}</strong>
          </div>
          <div className="metric-card" style={{ background: 'var(--color-primary-600)', borderColor: 'var(--color-primary-700)' }}>
            <span style={{ color: 'rgba(255,255,255,0.7)' }}>Total Facturado</span>
            <strong style={{ color: '#ffffff' }}>{formatMoneyFromCents(listedTotalCents)}</strong>
          </div>
          <div className="metric-card">
            <span>Sucursal</span>
            <strong>{branchName}</strong>
          </div>
        </div>

        <div className="filters-grid" style={{ marginBottom: '2rem', padding: '1.25rem', background: 'var(--color-slate-50)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-slate-100)' }}>
          <label className="field">
            <span>Fecha Inicial</span>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Fecha Final</span>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Registros</span>
            <select
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              style={{ padding: '0.5rem', background: '#ffffff' }}
            >
              {[25, 50, 100, 200].map(val => (
                <option key={val} value={val}>Mostrar {val}</option>
              ))}
            </select>
          </label>
        </div>

        {loading ? <Banner tone="info">Cargando ventas recientes...</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}

        <div className="sales-list">
          {!loading && sales.length === 0 ? (
            <div className="empty-state" style={{ padding: '4rem' }}>
              No hay ventas registradas en este periodo.
            </div>
          ) : (
            sales.map((sale) => {
              const createdAt = formatSaleDateTime(sale.created_at);
              const isVoid = sale.status === 'VOID';

              return (
                <button
                  key={sale.id}
                  className={`sale-row ${sale.id === selectedSaleId ? 'selected' : ''}`}
                  type="button"
                  style={{ 
                    padding: '1.25rem', 
                    textAlign: 'left', 
                    width: '100%', 
                    borderBottom: '1px solid var(--color-slate-100)',
                    opacity: isVoid ? 0.6 : 1
                  }}
                  onClick={() => void loadSaleDetail(sale.id)}
                >
                  <div className="sale-row-head" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <strong style={{ fontSize: '1rem', color: 'var(--color-slate-900)' }}>Venta #{sale.sale_number}</strong>
                        {isVoid && <span className="tag tag-danger" style={{ fontSize: '0.6rem' }}>ANULADA</span>}
                      </div>
                      <div className="subtle-text" style={{ fontSize: '0.8125rem' }}>
                        {createdAt.date} · {createdAt.time}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <strong className="sale-row-total" style={{ display: 'block', fontSize: '1.125rem', color: 'var(--color-slate-900)' }}>
                        {formatMoneyFromCents(sale.total_cents)}
                      </strong>
                    </div>
                  </div>

                  <div className="history-sale-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--color-slate-400)', fontWeight: 700, textTransform: 'uppercase' }}>Pago</span>
                      <strong style={{ fontSize: '0.875rem', fontWeight: 600 }}>{paymentModeLabel(sale.payment_json.mode)}</strong>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--color-slate-400)', fontWeight: 700, textTransform: 'uppercase' }}>DIAN</span>
                      <span className={statusClassName(sale.dian_status)} style={{ fontSize: '0.875rem', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                         {dianStatusLabel(sale.dian_status)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      <aside className="history-detail" style={{ borderLeft: '1px solid var(--color-slate-100)', background: 'var(--color-slate-50)' }}>
        <header className="section-heading" style={{ padding: '1.5rem 1.5rem 1rem' }}>
          <div className="heading-copy">
            <h3>Detalle de Transacción</h3>
            <p>Auditoría completa de items, impuestos y estado legal</p>
          </div>

          <div className="row-actions" style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <button 
              className="button button-sm ghost-button" 
              type="button" 
              onClick={handlePrint} 
              disabled={!selectedSaleDetail}
              style={{ flex: 1 }}
            >
              🖨️ Ticket
            </button>
            <PermissionGuard allowedPermissions={['sales:void', 'returns:create']}>
              <div style={{ display: 'flex', gap: '0.5rem', flex: 2 }}>
                <button
                  className="button button-sm"
                  type="button"
                  onClick={openVoidModal}
                  disabled={!selectedSale || selectedSale.status === 'VOID' || (role !== 'ADMIN' && role !== 'TENANT_OWNER' && !user?.permissions?.includes('sales:void'))}
                  style={{ flex: 1, background: 'var(--color-slate-200)', color: 'var(--color-error-600)', border: 'none' }}
                >
                  Anular
                </button>
                <button
                  className="button button-sm"
                  type="button"
                  onClick={() => setIsReturnModalOpen(true)}
                  disabled={!selectedSale || selectedSale.status === 'VOID' || (role !== 'ADMIN' && role !== 'TENANT_OWNER' && !user?.permissions?.includes('returns:create'))}
                  style={{ flex: 1, background: 'var(--color-primary-100)', color: 'var(--color-primary-700)', border: 'none' }}
                >
                  Devolver
                </button>
              </div>
            </PermissionGuard>
          </div>
        </header>

        {detailLoading ? <Banner tone="info">Cargando detalle...</Banner> : null}
        {detailError ? <Banner tone="error">{detailError}</Banner> : null}

        {!selectedSaleDetail ? (
          <div className="empty-state">Selecciona una venta para ver items, pagos y estado DIAN.</div>
        ) : (
          <div className="stack-md" style={{ padding: '0 1.5rem 2rem' }}>
            {selectedSaleDetail.sale.status === 'VOID' ? (
              <Banner tone="warning">
                <strong>Venta Anulada</strong>
                <p style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>
                  {selectedSaleDetail.sale.void_reason
                    ? `Motivo: ${selectedSaleDetail.sale.void_reason}`
                    : 'Sin motivo especificado'}
                </p>
                {selectedSaleDetail.sale.voided_at ? (
                  <p style={{ fontSize: '0.75rem', color: 'rgba(0,0,0,0.5)', marginTop: '0.25rem' }}>
                    Anulada el {new Date(selectedSaleDetail.sale.voided_at).toLocaleString('es-CO')}
                  </p>
                ) : null}
              </Banner>
            ) : null}

            <div className="detail-card" style={{ padding: '1.25rem', background: '#ffffff', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-slate-100)' }}>
              <div className="sale-row-head" style={{ marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid var(--color-slate-100)' }}>
                <div>
                  <strong style={{ fontSize: '1.125rem' }}>Venta #{selectedSaleDetail.sale.sale_number}</strong>
                  <div className="subtle-text" style={{ fontSize: '0.875rem' }}>
                    {new Date(selectedSaleDetail.sale.created_at).toLocaleString('es-CO')}
                  </div>
                </div>
              </div>

              <div className="detail-meta-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.25rem' }}>
                <div>
                  <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--color-slate-400)', fontWeight: 700, textTransform: 'uppercase' }}>Método de Pago</span>
                  <strong style={{ fontSize: '0.875rem' }}>{paymentModeLabel(selectedSaleDetail.sale.payment_json.mode)}</strong>
                </div>
                <div>
                  <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--color-slate-400)', fontWeight: 700, textTransform: 'uppercase' }}>Estado Legal</span>
                  <span
                    className={statusClassName(
                      selectedSaleDetail.dian_document?.status ?? selectedSaleDetail.sale.dian_status
                    )}
                    style={{ fontSize: '0.8125rem', padding: '0.1rem 0.4rem', borderRadius: '4px' }}
                  >
                    {dianStatusLabel(
                      selectedSaleDetail.dian_document?.status ?? selectedSaleDetail.sale.dian_status ?? undefined
                    )}
                  </span>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--color-slate-400)', fontWeight: 700, textTransform: 'uppercase' }}>CUDE / Hash DIAN</span>
                  <code style={{ display: 'block', marginTop: '0.25rem', padding: '0.5rem', background: 'var(--color-slate-50)', borderRadius: '4px', fontSize: '0.7rem', wordBreak: 'break-all' }}>
                    {selectedSaleDetail.dian_document?.cude ?? 'PENDIENTE DE PROCESAR'}
                  </code>
                </div>
              </div>
            </div>
            <div className="detail-card" style={{ padding: '1.25rem', background: '#ffffff', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-slate-100)' }}>
              <div className="section-heading" style={{ marginBottom: '1rem' }}>
                <h4 style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-slate-400)', textTransform: 'uppercase' }}>Artículos</h4>
              </div>

              <div className="detail-items" style={{ display: 'grid', gap: '0.75rem' }}>
                {selectedSaleDetail.items.map((item) => (
                  <div key={item.id} className="detail-item-row" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.875rem' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '6px', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--color-slate-100)' }}>
                       {item.imageUrl ? (
                         <img src={item.imageUrl} alt={item.product_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                       ) : (
                         <PlaceholderImage name={item.product_name ?? 'Producto'} size="sm" />
                       )}
                     </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.125rem' }}>
                        <span style={{ color: 'var(--color-slate-900)', fontWeight: 600 }}>{item.product_name}</span>
                        <strong style={{ color: 'var(--color-slate-900)' }}>{formatMoneyFromCents(item.line_total_cents)}</strong>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-400)' }}>
                        {formatMoneyFromCents(item.price_cents)} × {item.qty}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="detail-card" style={{ padding: '1.25rem', background: 'var(--color-slate-900)', color: '#ffffff', borderRadius: 'var(--radius-lg)' }}>
              <div className="totals-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' }}>
                  <span>Subtotal</span>
                  <span>{formatMoneyFromCents(selectedSaleDetail.sale.subtotal_cents)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' }}>
                  <span>Descuento</span>
                  <span>-{formatMoneyFromCents(selectedSaleDetail.sale.discount_cents)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' }}>
                  <span>Impuestos</span>
                  <span>{formatMoneyFromCents(selectedSaleDetail.sale.tax_total_cents)}</span>
                </div>
                <div className="summary-highlight" style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'rgba(255,255,255,0.8)' }}>Total</span>
                    <strong style={{ fontSize: '1.5rem' }}>{formatMoneyFromCents(selectedSaleDetail.sale.total_cents)}</strong>
                  </div>
                </div>
              </div>
            </div>

            {selectedSalePayments.length > 0 && (
              <div className="detail-card" style={{ padding: '1.25rem', background: '#ffffff', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-slate-100)' }}>
                <div className="section-heading" style={{ marginBottom: '0.75rem' }}>
                  <h4 style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-slate-400)', textTransform: 'uppercase' }}>Forma de Pago</h4>
                </div>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {selectedSalePayments.map((p, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', padding: '0.5rem 0', borderBottom: i < selectedSalePayments.length - 1 ? '1px solid var(--color-slate-100)' : 'none' }}>
                      <span style={{ color: 'var(--color-slate-600)' }}>{paymentMethodLabel(p.method)}</span>
                      <strong>{formatMoneyFromCents(p.amountCents)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      {isVoidModalOpen && selectedSale ? (
        <Modal ariaLabel="Anular venta" onClose={closeVoidModal}>
          <div className="stack-md">
            <div className="section-heading">
              <div>
                <h3>Anular venta #{selectedSale.sale_number}</h3>
                <p>Esta acción cambia la venta a estado VOID y deja trazabilidad operativa.</p>
              </div>
            </div>

            <div className="detail-card">
              <div className="detail-item-row">
                <span>Total</span>
                <strong>{formatMoneyFromCents(selectedSale.total_cents)}</strong>
              </div>
              <div className="detail-item-row">
                <span>Estado DIAN actual</span>
                <strong>{dianStatusLabel(selectedSale.dian_status)}</strong>
              </div>
            </div>

            <label className="field">
              <span>Motivo obligatorio</span>
              <textarea
                rows={4}
                placeholder="Ej. Cliente canceló el pedido o error de registro."
                value={voidReason}
                onChange={(event) => setVoidReason(event.target.value)}
                disabled={voidLoading}
              />
            </label>

            {detailError ? <Banner tone="error">{detailError}</Banner> : null}

            <Banner tone="warning">
              Confirma solo si verificaste que la venta no debe permanecer activa.
            </Banner>

            <div className="row-actions">
              <button
                className="danger-button"
                type="button"
                onClick={() => void handleVoidSale()}
                disabled={voidLoading || voidReason.trim().length < 3}
              >
                {voidLoading ? 'Anulando...' : 'Confirmar anulación'}
              </button>
              <button className="ghost-button" type="button" onClick={closeVoidModal} disabled={voidLoading}>
                Cancelar
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      <ReturnSaleModal
        api={api}
        saleDetail={selectedSaleDetail}
        isOpen={isReturnModalOpen}
        onClose={() => setIsReturnModalOpen(false)}
        onSuccess={() => {
          setIsReturnModalOpen(false);
          void loadSales();
        }}
      />
    </div>
  );
}
