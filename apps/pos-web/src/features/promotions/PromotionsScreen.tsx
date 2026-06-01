import { useState, useEffect, useCallback } from 'react';
import { Banner, ShellMessage } from '../../components/ui';
import type { PosApiClient } from '../../types';
import type { Promotion, ProductItem } from '../../lib/api';
import { formatMoneyFromCents } from '../../lib/format';
import { PromotionFormModal } from './components/PromotionFormModal';

interface Props {
  api: PosApiClient;
}

export function PromotionsScreen({ api }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [promosRes, prodsRes] = await Promise.all([
        api.listPromotions({}),
        api.listProducts({ limit: 500 }) // Adjust limit as needed
      ]);
      setPromotions(promosRes.items);
      setProducts(prodsRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleDelete(id: string) {
    if (!confirm('¿Seguro que deseas desactivar esta promoción?')) return;
    try {
      await api.deletePromotion(id);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al desactivar');
    }
  }

  function getProductName(productId: string) {
    return products.find(p => p.id === productId)?.name || 'Producto Desconocido';
  }

  function getPromotionValueDisplay(promo: Promotion) {
    if (promo.type === 'PERCENTAGE') return `${promo.value_cents / 100}% dto`;
    if (promo.type === 'FIXED_AMOUNT') return `${formatMoneyFromCents(promo.value_cents)} dto`;
    if (promo.type === 'BUY_X_GET_Y') return `Lleva ${promo.buy_qty! + promo.get_qty!} x ${promo.buy_qty!}`;
    return '-';
  }

  if (loading && promotions.length === 0) {
    return <ShellMessage title="Cargando promociones..." subtitle="Conectando al servidor" />;
  }

  return (
    <div className="stack-lg">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Promociones</h2>
          <p className="subtle-text">Gestiona los descuentos y promociones de tus productos.</p>
        </div>
        <button
          className="button"
          onClick={() => {
            setEditingPromotion(null);
            setIsModalOpen(true);
          }}
          style={{ background: 'var(--color-primary-600)', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Nueva Promoción
        </button>
      </header>

      {error && <Banner tone="error">{error}</Banner>}

      {promotions.length === 0 && !loading && !error ? (
        <div style={{ padding: '3rem', textAlign: 'center', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎁</div>
          <h3>No hay promociones activas</h3>
          <p className="subtle-text" style={{ marginTop: '0.5rem' }}>
            Crea tu primera promoción para aplicar descuentos automáticos en las ventas.
          </p>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--color-slate-600)' }}>Producto</th>
                <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--color-slate-600)' }}>Tipo</th>
                <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--color-slate-600)' }}>Valor</th>
                <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--color-slate-600)' }}>Fechas</th>
                <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--color-slate-600)' }}>Estado</th>
                <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--color-slate-600)', textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {promotions.map(promo => {
                const isActive = promo.active && new Date(promo.start_date) <= new Date() && (!promo.end_date || new Date(promo.end_date) > new Date());
                return (
                  <tr key={promo.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 500 }}>{getProductName(promo.product_id)}</td>
                    <td style={{ padding: '12px 16px', fontSize: '0.85rem' }}>
                      {promo.type === 'PERCENTAGE' && 'Descuento %'}
                      {promo.type === 'FIXED_AMOUNT' && 'Monto Fijo'}
                      {promo.type === 'BUY_X_GET_Y' && 'Pague X Lleve Y'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>{getPromotionValueDisplay(promo)}</td>
                    <td style={{ padding: '12px 16px', fontSize: '0.8rem', color: 'var(--color-slate-600)' }}>
                      Desde: {new Date(promo.start_date).toLocaleDateString()}<br />
                      {promo.end_date ? `Hasta: ${new Date(promo.end_date).toLocaleDateString()}` : 'Sin fecha fin'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {isActive ? (
                        <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 600 }}>Activa</span>
                      ) : (
                        <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 600 }}>Inactiva</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button
                          className="ghost-button"
                          style={{ padding: '4px 8px', fontSize: '0.85rem' }}
                          onClick={() => {
                            setEditingPromotion(promo);
                            setIsModalOpen(true);
                          }}
                        >
                          Editar
                        </button>
                        {promo.active && (
                          <button
                            className="ghost-button"
                            style={{ padding: '4px 8px', fontSize: '0.85rem', color: '#b91c1c' }}
                            onClick={() => void handleDelete(promo.id)}
                          >
                            Desactivar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <PromotionFormModal
          api={api}
          isOpen={isModalOpen}
          promotion={editingPromotion}
          products={products}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            setIsModalOpen(false);
            void loadData();
          }}
        />
      )}
    </div>
  );
}
