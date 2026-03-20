import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, Modal } from '../../components/ui';
import { formatMoneyFromCents, statusClassName, toDateInputValue } from '../../lib/format';
import { extractTicketPayments, printSaleTicket } from '../../lib/ticket-printer';
import type { SaleDetailResponse, SalesListItem, TenantTaxMode } from '../../lib/api';
import type { TicketTemplateConfig } from '../../lib/ticket-template';
import type { PosApiClient } from '../../types';
import { RoleGuard, useSession } from '../auth';
import { inferTaxModeFromSale } from '../sales';

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
  const { role } = useSession();
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
  const selectedSaleRequiresDianAdjustment = Boolean(
    selectedSaleDetail?.sale.status === 'VOID' && selectedSaleDetail.dian_document
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
    if (!selectedSale || role !== 'ADMIN' || selectedSale.status === 'VOID') {
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
    if (!selectedSale || role !== 'ADMIN' || selectedSale.status === 'VOID') {
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
        <div className="section-heading">
          <div>
            <h2>Historial de ventas</h2>
            <p>Consulta ventas recientes de esta sucursal y abre el detalle al instante.</p>
          </div>

          <button className="ghost-button" type="button" onClick={() => void loadSales()}>
            Recargar
          </button>
        </div>

        <div className="history-summary">
          <div className="metric-card">
            <span>Ventas</span>
            <strong>{sales.length}</strong>
          </div>
          <div className="metric-card">
            <span>Total listado</span>
            <strong>{formatMoneyFromCents(listedTotalCents)}</strong>
          </div>
          <div className="metric-card">
            <span>Sucursal</span>
            <strong>{branchName}</strong>
          </div>
        </div>

        <div className="filters-grid">
          <label className="field">
            <span>Desde</span>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Hasta</span>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Límite</span>
            <input
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            />
          </label>
        </div>

        {loading ? <Banner tone="info">Cargando ventas recientes...</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}

        <div className="sales-list">
          {!loading && sales.length === 0 ? (
            <div className="empty-state">No hay ventas en ese rango para esta sucursal.</div>
          ) : null}

          {sales.map((sale) => {
            const createdAt = formatSaleDateTime(sale.created_at);

            return (
              <button
                key={sale.id}
                className={`sale-row ${sale.id === selectedSaleId ? 'selected' : ''}`}
                type="button"
                onClick={() => void loadSaleDetail(sale.id)}
              >
                <div className="sale-row-head">
                  <div>
                    <strong>Venta #{sale.sale_number}</strong>
                    <div className="subtle-text">
                      {createdAt.date} · {createdAt.time}
                    </div>
                  </div>
                  <strong className="sale-row-total">{formatMoneyFromCents(sale.total_cents)}</strong>
                </div>

                <div className="history-sale-grid">
                  <div>
                    <span>Método</span>
                    <strong>{paymentModeLabel(sale.payment_json.mode)}</strong>
                  </div>
                  <div>
                    <span>Estado</span>
                    <strong>{sale.status}</strong>
                  </div>
                  <div>
                    <span>DIAN</span>
                    <span className={statusClassName(sale.dian_status)}>
                      DIAN {sale.dian_status ?? 'PENDING'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="history-detail">
        <div className="section-heading">
          <div>
            <h3>Detalle de venta</h3>
            <p>Visualiza items, pagos, impuestos y reimpresión del ticket.</p>
          </div>

          <div className="row-actions">
            <button className="ghost-button" type="button" onClick={handlePrint} disabled={!selectedSaleDetail}>
              Reimprimir ticket
            </button>
            <RoleGuard allowedRoles={['ADMIN']}>
              <button
                className="danger-button"
                type="button"
                onClick={openVoidModal}
                disabled={!selectedSale || selectedSale.status === 'VOID'}
              >
                Anular venta
              </button>
            </RoleGuard>
          </div>
        </div>

        {detailLoading ? <Banner tone="info">Cargando detalle...</Banner> : null}
        {detailError ? <Banner tone="error">{detailError}</Banner> : null}

        {!selectedSaleDetail ? (
          <div className="empty-state">Selecciona una venta para ver items, pagos y estado DIAN.</div>
        ) : (
          <div className="stack-md">
            {selectedSaleDetail.sale.status === 'VOID' ? (
              <Banner tone="warning">
                Venta anulada
                {selectedSaleDetail.sale.void_reason
                  ? ` · Motivo: ${selectedSaleDetail.sale.void_reason}`
                  : ''}
                {selectedSaleRequiresDianAdjustment
                  ? ' · Pendiente gestionar nota de ajuste DIAN.'
                  : ''}
              </Banner>
            ) : null}

            <div className="detail-card">
              <div className="sale-row-head">
                <div>
                  <strong>Venta #{selectedSaleDetail.sale.sale_number}</strong>
                  <div className="subtle-text">
                    {new Date(selectedSaleDetail.sale.created_at).toLocaleString('es-CO')}
                  </div>
                </div>
                <strong className="sale-row-total">
                  {formatMoneyFromCents(selectedSaleDetail.sale.total_cents)}
                </strong>
              </div>

              <div className="detail-meta-grid">
                <div>
                  <span>Método</span>
                  <strong>{paymentModeLabel(selectedSaleDetail.sale.payment_json.mode)}</strong>
                </div>
                <div>
                  <span>Estado venta</span>
                  <span
                    className={`tag ${
                      selectedSaleDetail.sale.status === 'VOID' ? 'tag-danger' : 'tag-success'
                    }`}
                  >
                    {selectedSaleDetail.sale.status}
                  </span>
                </div>
                <div>
                  <span>Estado DIAN</span>
                  <span
                    className={statusClassName(
                      selectedSaleDetail.dian_document?.status ?? selectedSaleDetail.sale.dian_status
                    )}
                  >
                    DIAN{' '}
                    {selectedSaleDetail.dian_document?.status ??
                      selectedSaleDetail.sale.dian_status ??
                      'PENDING'}
                  </span>
                </div>
                <div>
                  <span>CUDE</span>
                  <strong className="history-cude">
                    {selectedSaleDetail.dian_document?.cude ?? 'Pendiente'}
                  </strong>
                </div>
                <div>
                  <span>Anulada en</span>
                  <strong>
                    {selectedSaleDetail.sale.voided_at
                      ? new Date(selectedSaleDetail.sale.voided_at).toLocaleString('es-CO')
                      : 'No aplica'}
                  </strong>
                </div>
                <div>
                  <span>Motivo anulación</span>
                  <strong>{selectedSaleDetail.sale.void_reason ?? 'No aplica'}</strong>
                </div>
              </div>
            </div>

            <div className="detail-card">
              <div className="section-heading">
                <h3>Items</h3>
              </div>

              <div className="detail-items">
                {selectedSaleDetail.items.map((item) => (
                  <div key={item.id} className="detail-item-row">
                    <span>
                      {item.product_name} x {item.qty}
                    </span>
                    <strong>{formatMoneyFromCents(item.line_total_cents)}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="detail-card">
              <div className="section-heading">
                <h3>Pagos</h3>
              </div>

              <div className="payment-breakdown-list">
                {selectedSalePayments.map((payment, index) => (
                  <div key={`${payment.method}-${payment.amountCents}-${index}`} className="payment-breakdown-row">
                    <span>{paymentMethodLabel(payment.method)}</span>
                    <strong>{formatMoneyFromCents(payment.amountCents)}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="detail-card">
              <div className="section-heading">
                <h3>Resumen fiscal</h3>
              </div>

              <div className="totals-box">
                <div>
                  <span>Subtotal</span>
                  <strong>{formatMoneyFromCents(selectedSaleDetail.sale.subtotal_cents)}</strong>
                </div>
                <div>
                  <span>Descuento</span>
                  <strong>{formatMoneyFromCents(selectedSaleDetail.sale.discount_cents)}</strong>
                </div>
                <div>
                  <span>Impuestos</span>
                  <strong>{formatMoneyFromCents(selectedSaleDetail.sale.tax_total_cents)}</strong>
                </div>
                <div className="summary-highlight">
                  <span>Total</span>
                  <strong>{formatMoneyFromCents(selectedSaleDetail.sale.total_cents)}</strong>
                </div>
              </div>
            </div>
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
                <strong>{selectedSale.dian_status ?? 'PENDING'}</strong>
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
    </div>
  );
}
