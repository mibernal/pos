import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banner, ShellMessage, PlaceholderImage } from '../../components/ui';
import { PermissionGuard, useSession } from '../auth';

interface InventoryScreenProps {
  api: ReturnType<typeof import('../../lib/api').createApiClient>;
  branchId: string;
}

export function InventoryScreen({ api, branchId }: InventoryScreenProps) {
  const { role } = useSession();
  const isAdmin = role === 'ADMIN';
  const canSeeConsolidated = isAdmin || role === 'MANAGER' || role === 'AUDITOR';

  const [viewMode, setViewMode] = useState<'LOCAL' | 'CONSOLIDATED'>('LOCAL');

  const {
    data: productsRes,
    isLoading: isLoadingProducts,
    error: productsError
  } = useQuery({
    queryKey: ['products', branchId],
    queryFn: () => api.listProducts({ limit: 200, branchId })
  });

  const {
    data: balancesRes,
    isLoading: isLoadingBalances,
    error: balancesError
  } = useQuery({
    queryKey: ['balances', branchId],
    queryFn: () => api.listInventoryBalances(branchId)
  });

  const {
    data: consolidatedData,
    isLoading: isLoadingConsolidated,
    error: consolidatedError
  } = useQuery({
    queryKey: ['consolidatedInventory'],
    queryFn: () => api.listConsolidatedInventory(),
    enabled: canSeeConsolidated
  });

  const products = productsRes?.items || [];
  
  const balances = useMemo(() => {
    const map: Record<string, number> = {};
    if (balancesRes) {
      balancesRes.forEach((b) => {
        map[b.product_id] = Number(b.on_hand_qty);
      });
    }
    return map;
  }, [balancesRes]);

  const isLoading = isLoadingProducts || isLoadingBalances || (canSeeConsolidated && isLoadingConsolidated);
  const errorObj = productsError || balancesError || consolidatedError;
  const errorMessage = errorObj instanceof Error ? errorObj.message : (errorObj as string | null);

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
        <PermissionGuard allowedPermissions={['inventory:manage']}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', background: 'var(--color-slate-800)', borderRadius: '6px', padding: '0.25rem' }}>
              <button
                className={`ghost-button button-sm ${viewMode === 'LOCAL' ? 'is-active' : ''}`}
                style={{ background: viewMode === 'LOCAL' ? 'var(--color-slate-700)' : 'transparent', color: viewMode === 'LOCAL' ? '#fff' : 'inherit' }}
                onClick={() => setViewMode('LOCAL')}
              >
                Local
              </button>
              <button
                className={`ghost-button button-sm ${viewMode === 'CONSOLIDATED' ? 'is-active' : ''}`}
                style={{ background: viewMode === 'CONSOLIDATED' ? 'var(--color-slate-700)' : 'transparent', color: viewMode === 'CONSOLIDATED' ? '#fff' : 'inherit' }}
                onClick={() => setViewMode('CONSOLIDATED')}
              >
                Consolidado
              </button>
            </div>
          </div>
        </PermissionGuard>
      </div>

      {errorMessage && <Banner tone="error">{errorMessage}</Banner>}

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
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                  {viewMode === 'LOCAL' ? 'Stock Disponible' : 'Stock Total'}
                </th>
                {viewMode === 'CONSOLIDATED' && (
                  <th style={{ padding: '0.75rem 1rem' }}>Desglose por Sucursal</th>
                )}
              </tr>
            </thead>
            <tbody>
              {viewMode === 'LOCAL' && products.map((p) => {
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
                  </tr>
                );
              })}
              
              {viewMode === 'CONSOLIDATED' && (consolidatedData || []).map((p) => {
                const isLowStock = p.total_on_hand_qty <= 10;
                const isOutOfStock = p.total_on_hand_qty <= 0;

                return (
                  <tr key={p.product_id} style={{ borderBottom: '1px solid var(--color-slate-800)' }}>
                    <td style={{ padding: '0.5rem 1rem' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '4px', overflow: 'hidden' }}>
                        {p.image_url ? (
                          <img src={p.image_url ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <PlaceholderImage name={p.product_name} category={p.category} size="sm" />
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <strong>{p.product_name}</strong>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--color-slate-400)' }}>{p.category}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      <span className={`tag ${isOutOfStock ? 'tag-error' : isLowStock ? 'tag-warning' : 'tag-success'}`} style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                        {p.total_on_hand_qty} unds
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--color-slate-400)', fontSize: '0.8rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {(p.branches_breakdown as Array<{ branch_id: string; branch_name: string; on_hand_qty: number }>).map((b) => (
                          <div key={b.branch_id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                            <span>{b.branch_name}:</span>
                            <strong>{b.on_hand_qty}</strong>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
