import { useState } from 'react';
import { Banner, Modal } from '../../../components/ui';
import { formatMoneyFromCents } from '../../../lib/format';
import type { PosApiClient } from '../../../types';
import type { SaleDetailResponse } from '../../../lib/api';
import type { CreateReturnRequest } from '@pos-dian/shared';

export function ReturnSaleModal({
  api,
  saleDetail,
  isOpen,
  onClose,
  onSuccess
}: {
  api: PosApiClient;
  saleDetail: SaleDetailResponse | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refundSummary, setRefundSummary] = useState<{ amountCents: number; returnId: string } | null>(null);

  if (!isOpen || !saleDetail) {
    return null;
  }

  const { sale, items } = saleDetail;

  const totalRefundCents = items.reduce((sum, item) => {
    const qtyToReturn = returnQtys[item.product_id] || 0;
    // Ponderado muy básico: si devuelve N unidades, se devuelve la proporción de line_total_cents
    const unitPrice = item.qty > 0 ? item.line_total_cents / item.qty : 0;
    return sum + (unitPrice * qtyToReturn);
  }, 0);

  const handleQtyChange = (productId: string, val: string, max: number) => {
    const parsed = parseInt(val, 10);
    const qty = isNaN(parsed) ? 0 : Math.max(0, Math.min(max, parsed));
    setReturnQtys((prev) => ({
      ...prev,
      [productId]: qty
    }));
  };

  const handleReturn = async () => {
    const itemsToReturn = items
      .filter((item) => (returnQtys[item.product_id] || 0) > 0)
      .map((item) => ({
        product_id: item.product_id,
        qty: returnQtys[item.product_id]!
      }));

    if (itemsToReturn.length === 0) {
      setError('Debes seleccionar al menos un producto para devolver.');
      return;
    }

    if (!reason.trim()) {
      setError('El motivo de devolución es obligatorio.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload: CreateReturnRequest = {
        client_uuid: crypto.randomUUID(), // Used for idempotency
        reason: reason.trim(),
        items: itemsToReturn
      };

      const result = await api.createReturn(sale.id, payload);
      setRefundSummary({
        amountCents: result.total_refund_cents,
        returnId: result.return_id
      });
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible procesar la devolución.');
      setLoading(false);
    }
  };

  const handleFinish = () => {
    setRefundSummary(null);
    setReturnQtys({});
    setReason('');
    onSuccess();
  };

  return (
    <Modal ariaLabel="Devolución parcial" onClose={refundSummary ? handleFinish : onClose}>
      <div className="stack-md">
        <div className="section-heading">
          <div>
            <h3>Devolución de Venta #{sale.sale_number}</h3>
            <p>Selecciona los ítems a devolver e indica un motivo.</p>
          </div>
        </div>

        {refundSummary ? (
          <div className="stack-md">
            <Banner tone="info">
              <strong style={{ display: 'block', fontSize: '1rem', marginBottom: '0.25rem' }}>Devolución Procesada</strong>
              <p>Se ha generado el comprobante de devolución correctamente.</p>
            </Banner>

            <div className="detail-card">
              <div className="detail-item-row">
                <span>Total a Reembolsar (COP)</span>
                <strong style={{ color: 'var(--color-primary-600)', fontSize: '1.25rem' }}>
                  {formatMoneyFromCents(refundSummary.amountCents)}
                </strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="button button-outline"
                style={{ flex: 1 }}
                onClick={() => {
                  alert('Imprimiendo ticket de devolución...\nRef: ' + refundSummary.returnId + '\nReembolso: ' + formatMoneyFromCents(refundSummary.amountCents));
                }}
              >
                🖨️ Ticket Devolución
              </button>
              <button className="button" style={{ background: 'var(--color-primary-600)', color: '#fff', padding: '0.75rem', flex: 1 }} onClick={handleFinish}>
                Terminar
              </button>
            </div>
          </div>
        ) : (
          <div className="stack-md">
            <div className="detail-card" style={{ maxHeight: '300px', overflowY: 'auto', padding: '0.5rem' }}>
              <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-slate-200)', color: 'var(--color-slate-500)' }}>
                    <th style={{ padding: '0.5rem' }}>Producto</th>
                    <th style={{ padding: '0.5rem' }}>Precio</th>
                    <th style={{ padding: '0.5rem', textAlign: 'center' }}>Vendidos</th>
                    <th style={{ padding: '0.5rem', textAlign: 'center', width: '80px' }}>Devolver</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--color-slate-50)' }}>
                      <td style={{ padding: '0.5rem' }}>{item.product_name}</td>
                      <td style={{ padding: '0.5rem' }}>{formatMoneyFromCents(item.line_total_cents / (item.qty || 1))}</td>
                      <td style={{ padding: '0.5rem', textAlign: 'center' }}>{item.qty}</td>
                      <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                        <input
                          type="number"
                          min="0"
                          max={item.qty}
                          value={returnQtys[item.product_id] || ''}
                          onChange={(e) => handleQtyChange(item.product_id, e.target.value, item.qty)}
                          style={{ width: '60px', padding: '0.25rem', textAlign: 'center', border: '1px solid var(--color-slate-300)', borderRadius: '4px' }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0', borderTop: '1px solid var(--color-slate-200)', borderBottom: '1px solid var(--color-slate-200)' }}>
              <span style={{ fontWeight: 600 }}>Total Reembolso Calculado:</span>
              <strong style={{ fontSize: '1.25rem' }}>{formatMoneyFromCents(totalRefundCents)}</strong>
            </div>

            <label className="field">
              <span>Motivo de Devolución</span>
              <input
                type="text"
                placeholder="Ej. Producto defectuoso, cliente se arrepintió..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>

            {error ? <Banner tone="error">{error}</Banner> : null}

            <div className="row-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem' }}>
              <button
                className="button"
                style={{ background: 'var(--color-primary-600)', color: '#fff', padding: '0.75rem', flex: 1 }}
                onClick={() => void handleReturn()}
                disabled={loading || totalRefundCents === 0 || !reason.trim()}
              >
                {loading ? 'Procesando...' : 'Confirmar Devolución'}
              </button>
              <button className="ghost-button" style={{ padding: '0.75rem', flex: 1 }} onClick={onClose} disabled={loading}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
