import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ProductItem } from '../../lib/api';
import { Banner, ShellMessage } from '../../components/ui';
import { PermissionGuard } from '../auth';

interface InventoryAdjustmentsScreenProps {
  api: ReturnType<typeof import('../../lib/api').createApiClient>;
  branchId: string;
}

export function InventoryAdjustmentsScreen({ api, branchId }: InventoryAdjustmentsScreenProps) {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [operation, setOperation] = useState<'MANUAL_ENTRY' | 'MANUAL_EXIT'>('MANUAL_ENTRY');
  const [qtyChange, setQtyChange] = useState<number>(1);
  const [reason, setReason] = useState('SOBRANTE');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const productsRes = await api.listProducts({ limit: 500, branchId });
      setProducts(productsRes.items);
      if (productsRes.items.length > 0 && !selectedProductId) {
        setSelectedProductId(productsRes.items[0]!.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar productos');
    } finally {
      setIsLoading(false);
    }
  }, [api, branchId, selectedProductId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Sync reason options with operation
  useEffect(() => {
    if (operation === 'MANUAL_ENTRY') {
      setReason('SOBRANTE');
    } else {
      setReason('MERMA');
    }
  }, [operation]);

  const handleSaveAdjustment = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedProductId || qtyChange <= 0) return;

    setIsSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.createInventoryAdjustment({
        branch_id: branchId,
        product_id: selectedProductId,
        qty_change: operation === 'MANUAL_EXIT' ? -qtyChange : qtyChange,
        reason: reason,
        notes: notes.trim() || undefined
      });
      
      setSuccessMsg('Ajuste registrado exitosamente en el ledger de inventario.');
      setQtyChange(1);
      setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar el ajuste');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <ShellMessage title="Cargando Productos..." subtitle="Preparando módulo de ajustes" />;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1rem', minHeight: '0', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Ajustes de Inventario</h2>
          <p style={{ color: 'var(--color-slate-400)', margin: '0.25rem 0 0 0' }}>
            Registrar entradas y salidas de mercancía no transaccionales
          </p>
        </div>
      </div>

      <PermissionGuard allowedPermissions={['inventory:manage']}>
        <form onSubmit={handleSaveAdjustment} className="setup-card" style={{ background: 'var(--color-bg)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--color-slate-800)' }}>
          {error && <Banner tone="error">{error}</Banner>}
          {successMsg && <Banner tone="success">{successMsg}</Banner>}
          
          <div className="stack-md" style={{ marginTop: error || successMsg ? '1rem' : '0' }}>
            <label className="field">
              <span style={{ fontWeight: 600 }}>Producto a Ajustar</span>
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                required
                style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-slate-700)', background: 'var(--color-slate-800)', color: 'white' }}
              >
                <option value="" disabled>Seleccione un producto</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} {p.barcode ? `(${p.barcode})` : ''}</option>
                ))}
              </select>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <label className="field">
                <span style={{ fontWeight: 600 }}>Tipo de Operación</span>
                <select
                  value={operation}
                  onChange={(e) => setOperation(e.target.value as 'MANUAL_ENTRY' | 'MANUAL_EXIT')}
                  required
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-slate-700)', background: 'var(--color-slate-800)', color: 'white' }}
                >
                  <option value="MANUAL_ENTRY">Entrada (+)</option>
                  <option value="MANUAL_EXIT">Salida / Merma (-)</option>
                </select>
              </label>

              <label className="field">
                <span style={{ fontWeight: 600 }}>Cantidad</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={qtyChange}
                  onChange={(e) => setQtyChange(Number(e.target.value))}
                  required
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-slate-700)', background: 'var(--color-slate-800)', color: 'white' }}
                />
              </label>
            </div>

            <label className="field">
              <span style={{ fontWeight: 600 }}>Razón de Ajuste</span>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-slate-700)', background: 'var(--color-slate-800)', color: 'white' }}
              >
                {operation === 'MANUAL_ENTRY' ? (
                  <>
                    <option value="SOBRANTE">Sobrante en inventario físico</option>
                    <option value="AJUSTE">Ajuste de sistema</option>
                    <option value="INGRESO_ESPECIAL">Ingreso extraordinario</option>
                  </>
                ) : (
                  <>
                    <option value="MERMA">Merma o daño</option>
                    <option value="ROBO">Pérdida o Robo</option>
                    <option value="CONSUMO">Consumo interno</option>
                    <option value="AJUSTE">Ajuste de sistema</option>
                    <option value="VENCIMIENTO">Caducidad / Vencimiento</option>
                  </>
                )}
              </select>
            </label>

            <label className="field">
              <span style={{ fontWeight: 600 }}>Notas adicionales (Opcional)</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: Autorizado por Gerencia, Producto encontrado en bodega trasera..."
                style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-slate-700)', background: 'var(--color-slate-800)', color: 'white' }}
              />
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button 
                type="submit" 
                className="button" 
                style={{ background: 'var(--color-primary-600)', color: '#fff', padding: '0.75rem 2rem', fontSize: '1rem' }} 
                disabled={isSaving}
              >
                {isSaving ? 'Registrando...' : 'Confirmar Ajuste'}
              </button>
            </div>
          </div>
        </form>
      </PermissionGuard>
    </div>
  );
}
