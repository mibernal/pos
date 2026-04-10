import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { ProductItem } from '../../lib/api';
import { Banner, Modal, ShellMessage, PlaceholderImage } from '../../components/ui';
import { RoleGuard, useSession } from '../auth';

interface InventoryScreenProps {
  api: ReturnType<typeof import('../../lib/api').createApiClient>;
  branchId: string;
}

export function InventoryScreen({ api, branchId }: InventoryScreenProps) {
  const { role } = useSession();
  const isAdmin = role === 'ADMIN';

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [operation, setOperation] = useState<'MANUAL_ENTRY' | 'MANUAL_EXIT'>('MANUAL_ENTRY');
  const [qtyChange, setQtyChange] = useState<number>(1);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Cargamos catálogo y saldos en paralelo
      const [productsRes, balancesRes] = await Promise.all([
        api.listProducts({ limit: 200, branchId }),
        api.listInventoryBalances(branchId)
      ]);

      setProducts(productsRes.items);

      // Convertir arreglo de balances a diccionario para acceso O(1)
      const balancesMap: Record<string, number> = {};
      balancesRes.forEach((b) => {
        balancesMap[b.product_id] = Number(b.qty);
      });
      setBalances(balancesMap);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar inventario');
    } finally {
      setIsLoading(false);
    }
  }, [api, branchId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openAdjustModal = (productId?: string) => {
    if (productId) setSelectedProductId(productId);
    else if (products.length > 0) setSelectedProductId(products[0]!.id);
    
    setOperation('MANUAL_ENTRY');
    setQtyChange(1);
    setNotes('');
    setIsModalOpen(true);
  };

  const handleSaveAdjustment = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedProductId || qtyChange <= 0) return;

    setIsSaving(true);
    setError(null);
    try {
      await api.createInventoryTransaction({
        branch_id: branchId,
        product_id: selectedProductId,
        operation: operation,
        qty_change: operation === 'MANUAL_EXIT' ? -qtyChange : qtyChange,
        notes: notes.trim() || undefined
      });
      
      setIsModalOpen(false);
      await loadData(); // Recargar saldos
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar transacción');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <ShellMessage title="Cargando Kárdex..." subtitle="Obteniendo saldos de inventario de la bodega" />;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1rem', minHeight: '0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Stock e Inventario</h2>
          <p style={{ color: 'var(--color-slate-400)', margin: '0.25rem 0 0 0' }}>
            Control de entrada y salida de mercancía
          </p>
        </div>
        <RoleGuard allowedRoles={['ADMIN']}>
          <button onClick={() => openAdjustModal()} className="button" style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
            + Ajuste Manual
          </button>
        </RoleGuard>
      </div>

      {error && !isModalOpen && <Banner tone="error">{error}</Banner>}

      {products.length === 0 ? (
        <div className="empty-state" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <h3 style={{ fontSize: '1.125rem', marginBottom: '0.5rem' }}>Sin productos</h3>
          <p style={{ color: 'var(--color-slate-500)', marginBottom: '1.5rem' }}>
            Aún no has creado productos en esta sucursal. Crea un producto en el catálogo primero.
          </p>
        </div>
      ) : (
        <div style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-slate-700)', borderRadius: '8px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead style={{ borderBottom: '1px solid var(--color-slate-700)', backgroundColor: 'var(--color-slate-800)' }}>
              <tr>
                <th style={{ padding: '0.75rem 1rem', width: '50px' }}>Img</th>
                <th style={{ padding: '0.75rem 1rem' }}>Producto</th>
                <th style={{ padding: '0.75rem 1rem' }}>Categoría</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Stock Disponible</th>
                {isAdmin && (
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'center', width: '100px' }}>Acciones</th>
                )}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const qty = balances[p.id] || 0;
                const isLowStock = qty <= 5;
                const isOutOfStock = qty <= 0;

                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--color-slate-800)' }}>
                    <td style={{ padding: '0.5rem 1rem' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '4px', overflow: 'hidden' }}>
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <PlaceholderImage name={p.name} category={p.category} size="sm" />
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <strong>{p.name}</strong>
                      {p.barcode && <div style={{ fontSize: '0.7rem', color: 'var(--color-slate-500)' }}>{p.barcode}</div>}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--color-slate-400)' }}>{p.category}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      <span className={`tag ${isOutOfStock ? 'tag-error' : isLowStock ? 'tag-warning' : 'tag-success'}`} style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                        {qty} unds
                      </span>
                    </td>
                    {isAdmin && (
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        <button className="ghost-button button-sm" onClick={() => openAdjustModal(p.id)}>
                          ± Ajustar
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <Modal
          ariaLabel="Ajuste de Inventario"
          onClose={() => setIsModalOpen(false)}
        >
          <div style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
              Registrar Movimiento (Ajuste Manual)
            </h3>
            <form onSubmit={handleSaveAdjustment} className="stack-md">
              {error && <Banner tone="error">{error}</Banner>}
              
              <label className="field">
                <span>Producto</span>
                <select
                  value={selectedProductId}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedProductId(e.target.value)}
                  required
                >
                  <option value="" disabled>Seleccione un producto</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <label className="field">
                  <span>Operación</span>
                  <select
                    value={operation}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setOperation(e.target.value as 'MANUAL_ENTRY' | 'MANUAL_EXIT')}
                    required
                  >
                    <option value="MANUAL_ENTRY">Entrada (+)</option>
                    <option value="MANUAL_EXIT">Salida / Merma (-)</option>
                  </select>
                </label>

                <label className="field">
                  <span>Cantidad</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={qtyChange}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setQtyChange(Number(e.target.value))}
                    required
                  />
                </label>
              </div>

              <label className="field">
                <span>Notas (Opcional)</span>
                <input
                  value={notes}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNotes(e.target.value)}
                  placeholder="Ej: Ajuste por merma, ingreso de proveedor..."
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSaving}
                >
                  Cancelar
                </button>
                <button type="submit" className="button" style={{ background: 'var(--color-primary-600)', color: '#fff' }} disabled={isSaving}>
                  {isSaving ? 'Guardando...' : 'Aplicar Movimiento'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}
