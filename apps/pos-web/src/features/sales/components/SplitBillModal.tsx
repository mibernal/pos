import { useState } from 'react';
import { Modal } from '../../../components/ui';
import type { CartItem } from '../../../types';
import { formatMoneyFromCents } from '../../../lib/format';

export type SplitMode = 'EQUAL' | 'PERCENTAGE' | 'PRODUCTS';

interface SplitBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  totalCents: number;
  onSelectMode: (mode: SplitMode, payload?: any) => void;
}

export function SplitBillModal({ isOpen, onClose, cartItems, totalCents, onSelectMode }: SplitBillModalProps) {
  const [mode, setMode] = useState<SplitMode | null>(null);
  const [numberOfPeople, setNumberOfPeople] = useState<number>(2);

  if (!isOpen) return null;

  return (
    <Modal ariaLabel="Dividir cuenta" onClose={onClose} size="default">
      <div className="checkout-modal" style={{ padding: '1.5rem' }}>
        <div className="checkout-header" style={{ borderBottom: '1px solid var(--color-slate-200)', paddingBottom: '1rem', marginBottom: '1rem' }}>
          <div>
            <h3>Dividir Cuenta</h3>
            <p>Total: {formatMoneyFromCents(totalCents)}</p>
          </div>
          <button className="ghost-button" onClick={onClose}>Cerrar</button>
        </div>

        {!mode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <button 
              className="secondary-button" 
              style={{ padding: '1rem', justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => setMode('EQUAL')}
            >
              <strong style={{ display: 'block' }}>Partes Iguales</strong>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-slate-500)' }}>1 sola factura, pagos divididos entre varias personas.</span>
            </button>
            <button 
              className="secondary-button" 
              style={{ padding: '1rem', justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => onSelectMode('PERCENTAGE')}
            >
              <strong style={{ display: 'block' }}>Porcentajes</strong>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-slate-500)' }}>1 sola factura, cada persona paga un porcentaje.</span>
            </button>
            <button 
              className="secondary-button" 
              style={{ padding: '1rem', justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => onSelectMode('PRODUCTS')}
            >
              <strong style={{ display: 'block' }}>Por Productos</strong>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-slate-500)' }}>Facturas separadas, cada persona paga lo que consumió.</span>
            </button>
          </div>
        ) : mode === 'EQUAL' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <label className="field">
              <span>¿Entre cuántas personas?</span>
              <input 
                type="number" 
                min={2} 
                max={15}
                value={numberOfPeople}
                onChange={(e) => setNumberOfPeople(parseInt(e.target.value) || 2)}
              />
            </label>
            <div className="pos-totals-row is-total" style={{ padding: '1rem', background: 'var(--color-slate-50)', borderRadius: '8px' }}>
              <span>Cada uno paga:</span>
              <span>{formatMoneyFromCents(Math.round(totalCents / numberOfPeople))}</span>
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button className="ghost-button" onClick={() => setMode(null)} style={{ flex: 1 }}>Volver</button>
              <button 
                className="primary-button" 
                onClick={() => onSelectMode('EQUAL', { parts: numberOfPeople })}
                style={{ flex: 1 }}
              >
                Continuar
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
