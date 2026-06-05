import { formatMoneyFromCents } from '../../../lib/format';
import type { CartItem } from '../../../types';
import { readScaleWeight } from '../../../lib/hardware';
import { useState } from 'react';

export interface CartPanelProps {
  cartItems: CartItem[];
  cartQuantity: number;
  selectedCartIndex: number;
  clearCart: () => void;
  setSelectedCartIndex: (index: number) => void;
  updateCartQty: (index: number, qty: number) => void;
  removeCartItem: (index: number) => void;
}

export function CartPanel({
  cartItems,
  cartQuantity,
  selectedCartIndex,
  clearCart,
  setSelectedCartIndex,
  updateCartQty,
  removeCartItem
}: CartPanelProps) {
  const [scaleReadingIndex, setScaleReadingIndex] = useState<number | null>(null);

  async function handleReadScale(index: number) {
    try {
      setScaleReadingIndex(index);
      const weight = await readScaleWeight();
      updateCartQty(index, weight);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error en la báscula');
    } finally {
      setScaleReadingIndex(null);
    }
  }

  return (
    <aside className="cart-panel">
      <header className="section-heading">
        <div className="heading-copy">
          <h3>Orden Actual</h3>
          <p>{cartQuantity} {cartQuantity === 1 ? 'producto' : 'productos'}</p>
        </div>
        {cartItems.length > 0 && (
          <button className="ghost-button" style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem' }} onClick={clearCart}>
            Vaciar
          </button>
        )}
      </header>

      <div className="cart-list">
        {cartItems.length === 0 ? (
          <div className="empty-state" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '2rem', color: 'var(--color-slate-400)' }}>
            <div>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🛒</div>
              <p>El carrito está vacío</p>
            </div>
          </div>
        ) : (
          cartItems.map((item, index) => (
            <article
              key={item.productId}
              className={`cart-row ${index === selectedCartIndex ? 'selected' : ''}`}
              onClick={() => setSelectedCartIndex(index)}
              role="button"
              tabIndex={0}
            >
              <div className="cart-row-main">
                <div className="cart-row-name">
                  <strong>{item.name} {item.variantName ? `(${item.variantName})` : ''}</strong>
                  <div className="cart-row-submeta">
                    <span>{formatMoneyFromCents(item.priceCents)} c/u</span>
                    {item.barcode && <span className="tag-muted">{item.barcode}</span>}
                  </div>
                </div>
                <strong style={{ color: 'var(--color-slate-900)' }}>{formatMoneyFromCents(item.priceCents * item.qty)}</strong>
              </div>

              <div className="cart-row-controls">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'var(--color-slate-200)', borderRadius: 'var(--radius-md)', padding: '0.25rem' }}>
                  <button
                    type="button"
                    className="mini-btn"
                    style={{ border: 'none', background: 'transparent', boxShadow: 'none', padding: '0.4rem 0.6rem', minWidth: '32px' }}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateCartQty(index, item.qty - 1);
                    }}
                  >
                    -
                  </button>
                  <input
                    aria-label="Cantidad"
                    className="cart-row-qty"
                    style={{ border: 'none', background: '#ffffff', height: '2rem', fontSize: '0.875rem', padding: '0 0.5rem', minWidth: '40px', textAlign: 'center' }}
                    value={item.qty}
                    type="number"
                    min={1}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updateCartQty(index, Number(event.target.value))}
                  />
                  <button
                    type="button"
                    className="mini-btn"
                    style={{ border: 'none', background: 'transparent', boxShadow: 'none', padding: '0.4rem 0.6rem', minWidth: '32px' }}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateCartQty(index, item.qty + 1);
                    }}
                  >
                    +
                  </button>
                  {/* Báscula Button */}
                  {'serial' in navigator && (
                    <button
                      type="button"
                      className="mini-btn"
                      style={{ border: 'none', background: 'var(--color-slate-300)', boxShadow: 'none', marginLeft: '0.25rem', padding: '0.2rem 0.4rem', fontSize: '0.7rem' }}
                      title="Leer peso desde báscula conectada"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleReadScale(index);
                      }}
                      disabled={scaleReadingIndex === index}
                    >
                      {scaleReadingIndex === index ? '⌛' : '⚖️'}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  style={{ border: 'none', color: 'var(--color-error-600)', background: 'transparent', boxShadow: 'none', padding: '0.25rem' }}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeCartItem(index);
                  }}
                >
                  🗑️
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
