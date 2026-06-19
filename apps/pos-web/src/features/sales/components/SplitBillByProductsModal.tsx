import { useState, useMemo } from 'react';
import { Modal } from '../../../components/ui';
import type { CartItem } from '../../../types';
import { formatMoneyFromCents } from '../../../lib/format';

interface SplitBillByProductsModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onConfirm: (selectedItems: CartItem[], discountCents: number, subtotalCents: number, totalCents: number) => void;
}

export function SplitBillByProductsModal({ isOpen, onClose, cartItems, onConfirm }: SplitBillByProductsModalProps) {
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});

  const handleQtyChange = (itemId: string, qty: number, maxQty: number) => {
    if (qty < 0) qty = 0;
    if (qty > maxQty) qty = maxQty;
    
    setSelectedQuantities(prev => ({
      ...prev,
      [itemId]: qty
    }));
  };

  const getLineId = (item: CartItem) => `${item.productId}-${item.variantId || 'base'}`;

  const selectedItems = useMemo(() => {
    return cartItems.map(item => {
      const id = getLineId(item);
      const qty = selectedQuantities[id] || 0;
      return { ...item, qty };
    }).filter(item => item.qty > 0);
  }, [cartItems, selectedQuantities]);

  const subtotalCents = useMemo(() => selectedItems.reduce((acc, item) => acc + (item.priceCents * item.qty), 0), [selectedItems]);
  const totalCents = subtotalCents; // Simplificado: no descontamos proporcionalmente aún

  const handleConfirm = () => {
    if (selectedItems.length === 0) return;
    onConfirm(selectedItems, 0, subtotalCents, totalCents);
  };

  if (!isOpen) return null;

  return (
    <Modal ariaLabel="Dividir por productos" onClose={onClose} size="wide">
      <div className="checkout-modal" style={{ padding: '1.5rem' }}>
        <div className="checkout-header" style={{ borderBottom: '1px solid var(--color-slate-200)', paddingBottom: '1rem', marginBottom: '1rem' }}>
          <div>
            <h3>Dividir por Productos</h3>
            <p>Selecciona qué productos pagará esta persona.</p>
          </div>
          <button className="ghost-button" onClick={onClose}>Cancelar</button>
        </div>

        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-slate-200)' }}>
                <th style={{ padding: '0.5rem' }}>Producto</th>
                <th style={{ padding: '0.5rem' }}>Precio</th>
                <th style={{ padding: '0.5rem' }}>A pagar / Total</th>
                <th style={{ padding: '0.5rem' }}>Total Línea</th>
              </tr>
            </thead>
            <tbody>
              {cartItems.map((item) => {
                const id = getLineId(item);
                const selectedQty = selectedQuantities[id] || 0;
                return (
                  <tr key={id} style={{ borderBottom: '1px solid var(--color-slate-100)' }}>
                    <td style={{ padding: '0.5rem' }}>
                      {item.name} {item.variantName ? `(${item.variantName})` : ''}
                    </td>
                    <td style={{ padding: '0.5rem' }}>{formatMoneyFromCents(item.priceCents)}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <button className="ghost-button" onClick={() => handleQtyChange(id, selectedQty - 1, item.qty)}>-</button>
                        <span style={{ fontWeight: 'bold' }}>{selectedQty}</span>
                        <span style={{ color: 'var(--color-slate-500)' }}>/ {item.qty}</span>
                        <button className="ghost-button" onClick={() => handleQtyChange(id, selectedQty + 1, item.qty)}>+</button>
                      </div>
                    </td>
                    <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>
                      {formatMoneyFromCents(selectedQty * item.priceCents)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="checkout-actions" style={{ marginTop: '1.5rem', borderTop: '1px solid var(--color-slate-200)', paddingTop: '1rem' }}>
          <div className="pos-totals-row is-total" style={{ flex: 1, margin: 0, padding: 0 }}>
            <span>Total a Cobrar:</span>
            <span>{formatMoneyFromCents(totalCents)}</span>
          </div>
          <button 
            className="primary-button" 
            onClick={handleConfirm}
            disabled={selectedItems.length === 0}
          >
            Cobrar Selección
          </button>
        </div>
      </div>
    </Modal>
  );
}
