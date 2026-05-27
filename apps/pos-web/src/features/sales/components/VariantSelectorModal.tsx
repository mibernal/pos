import { Modal } from '../../../components/ui';
import { formatMoneyFromCents } from '../../../lib/format';
import type { ProductItem } from '../../../lib/api';

export interface VariantSelectorModalProps {
  isOpen: boolean;
  product: ProductItem | null;
  onClose: () => void;
  onSelect: (variant: { id: string, name: string, price_cents: number }) => void;
}

export function VariantSelectorModal({ isOpen, product, onClose, onSelect }: VariantSelectorModalProps) {
  if (!product || !isOpen) return null;

  return (
    <Modal ariaLabel={`Seleccionar variante de ${product.name}`} onClose={onClose}>
      <h3>Seleccionar Variante - {product.name}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
        {product.variants?.map(variant => (
          <button
            key={variant.id}
            onClick={() => {
              onSelect({
                id: variant.id,
                name: variant.name,
                price_cents: variant.price_cents
              });
            }}
            style={{
              padding: '1.5rem',
              border: '1px solid var(--color-slate-200)',
              borderRadius: '8px',
              background: '#fff',
              cursor: 'pointer',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-primary-500)';
              e.currentTarget.style.boxShadow = 'var(--shadow-md)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-slate-200)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <span style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-slate-900)' }}>
              {variant.name}
            </span>
            <span style={{ fontSize: '1rem', color: 'var(--color-primary-600)' }}>
              {formatMoneyFromCents(variant.price_cents)}
            </span>
          </button>
        ))}
      </div>
      
      <div className="modal-actions" style={{ marginTop: '2rem' }}>
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
