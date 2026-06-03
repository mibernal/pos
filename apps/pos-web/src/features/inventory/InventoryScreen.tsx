import { useState, useMemo, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, ShellMessage, PlaceholderImage } from '../../components/ui';
import { PermissionGuard, useSession } from '../auth';
import type { ProductItem } from '../../lib/api';

interface InventoryScreenProps {
  api: ReturnType<typeof import('../../lib/api').createApiClient>;
  branchId: string;
}

export function InventoryScreen({ api, branchId }: InventoryScreenProps) {
  const { role } = useSession();
  const isAdmin = role === 'ADMIN';
  const canSeeConsolidated = isAdmin || role === 'MANAGER' || role === 'AUDITOR';
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<'LOCAL' | 'CONSOLIDATED'>('LOCAL');
  
  // Adjustment Modal State
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [operation, setOperation] = useState<'MANUAL_ENTRY' | 'MANUAL_EXIT'>('MANUAL_ENTRY');
  const [qtyChange, setQtyChange] = useState<number>(1);
  const [reason, setReason] = useState('SOBRANTE');
  const [notes, setNotes] = useState('');
  const [isSavingAdjustment, setIsSavingAdjustment] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);
  const [adjustmentSuccess, setAdjustmentSuccess] = useState<string | null>(null);

  // Múltiples filas para ajuste manual
  const [adjustmentRows, setAdjustmentRows] = useState<Array<{ id: string; productId: string; qtyChange: number }>>([]);

  const {
    data: productsRes,
    isLoading: isLoadingProducts,
    error: productsError
  } = useQuery({
    queryKey: ['products', branchId],
    queryFn: () => api.listProducts({ limit: 500, branchId })
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

  const openAdjustmentModal = (productId?: string) => {
    setAdjustmentError(null);
    setAdjustmentSuccess(null);
    setAdjustmentRows([{
      id: crypto.randomUUID(),
      productId: productId || (products.length > 0 ? products[0]?.id || '' : ''),
      qtyChange: 1
    }]);
    setNotes('');
    setOperation('MANUAL_ENTRY');
    setReason('SOBRANTE');
    setIsAdjustmentModalOpen(true);
  };

  const addAdjustmentRow = () => {
    setAdjustmentRows([
      ...adjustmentRows, 
      { id: crypto.randomUUID(), productId: products[0]?.id || '', qtyChange: 1 }
    ]);
  };

  const updateRow = (id: string, field: 'productId' | 'qtyChange', value: string | number) => {
    setAdjustmentRows(rows => rows.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeRow = (id: string) => {
    setAdjustmentRows(rows => rows.filter(r => r.id !== id));
  };

  const handleSaveAdjustment = async (e: FormEvent) => {
    e.preventDefault();
    const validRows = adjustmentRows.filter(r => r.productId && r.qtyChange > 0);
    if (validRows.length === 0) return setAdjustmentError('Añade al menos un producto con cantidad válida.');

    setIsSavingAdjustment(true);
    setAdjustmentError(null);
    setAdjustmentSuccess(null);
    try {
      await api.createInventoryAdjustment({
        branch_id: branchId,
        reason: reason,
        notes: notes.trim() || undefined,
        items: validRows.map(r => ({
          product_id: r.productId,
          qty_change: operation === 'MANUAL_EXIT' ? -r.qtyChange : r.qtyChange,
        }))
      });
      
      setAdjustmentSuccess('Ajuste registrado exitosamente.');
      setAdjustmentRows([]);
      setNotes('');
      // Refresh balances
      await queryClient.invalidateQueries({ queryKey: ['balances', branchId] });
      
      setTimeout(() => {
        setIsAdjustmentModalOpen(false);
      }, 1500);
    } catch (err) {
      setAdjustmentError(err instanceof Error ? err.message : 'Error al registrar el ajuste');
    } finally {
      setIsSavingAdjustment(false);
    }
  };

  const handleExportCSV = () => {
    const header = "id,name,category,tax_category,barcode,price_cents,active,stock_to_add\n";
    const rows = products.map(p => 
      `${p.id},"${p.name}","${p.category}","${p.taxCategory || 'IVA_19'}",${p.barcode || ''},${p.price_cents},${p.active ? 'true' : 'false'},0`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `inventario_${branchId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsSavingAdjustment(true);
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      
      const itemsToImport: Array<any> = [];
      
      // Parse header to find column indices
      const headerLine = lines[0]?.toLowerCase().split(',') || [];
      const colMap: Record<string, number> = {};
      headerLine.forEach((col, idx) => colMap[col.trim().replace(/"/g, '')] = idx);

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        
        // Simple regex to split by comma but ignore commas inside quotes
        const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        const cleanPart = (idx: number | undefined) => (idx !== undefined ? (parts[idx] || '').trim().replace(/^"|"$/g, '') : '');
        
        const id = cleanPart(colMap['id']);
        const name = cleanPart(colMap['name']);
        const category = cleanPart(colMap['category']) || 'General';
        const tax_category = cleanPart(colMap['tax_category']) || 'IVA_19';
        const barcode = cleanPart(colMap['barcode']);
        const price_cents = parseInt(cleanPart(colMap['price_cents']) || '0', 10);
        const active = cleanPart(colMap['active']) !== 'false';
        const stock_to_add = parseInt(cleanPart(colMap['stock_to_add']) || '0', 10);
        
        if (name) {
          itemsToImport.push({
            id: id || undefined,
            name,
            category,
            tax_category,
            barcode: barcode || null,
            price_cents,
            active,
            stock_to_add
          });
        }
      }

      if (itemsToImport.length > 0) {
        const res = await api.bulkImport({ items: itemsToImport }, branchId);
        setAdjustmentSuccess(`Se importaron/actualizaron ${res.imported} productos vía CSV.`);
        await queryClient.invalidateQueries({ queryKey: ['products', branchId] });
        await queryClient.invalidateQueries({ queryKey: ['balances', branchId] });
      } else {
        setAdjustmentError('No se encontraron productos válidos en el archivo CSV.');
      }
    } catch (err) {
      setAdjustmentError(err instanceof Error ? err.message : 'Error al importar CSV');
    } finally {
      setIsSavingAdjustment(false);
      if (e.target) e.target.value = '';
    }
  };

  // Sync reason options with operation
  useMemo(() => {
    if (operation === 'MANUAL_ENTRY' && reason !== 'SOBRANTE' && reason !== 'AJUSTE' && reason !== 'INGRESO_ESPECIAL') {
      setReason('SOBRANTE');
    } else if (operation === 'MANUAL_EXIT' && reason !== 'MERMA' && reason !== 'ROBO' && reason !== 'CONSUMO' && reason !== 'AJUSTE' && reason !== 'VENCIMIENTO') {
      setReason('MERMA');
    }
  }, [operation, reason]);


  if (isLoading && !isAdjustmentModalOpen) {
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
            {viewMode === 'LOCAL' && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  className="ghost-button button-sm"
                  onClick={handleExportCSV}
                >
                  📥 Exportar CSV
                </button>
                <label className="ghost-button button-sm" style={{ cursor: 'pointer', margin: 0 }}>
                  📤 Importar CSV
                  <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => void handleImportCSV(e)} />
                </label>
              </div>
            )}
            <button
              className="button button-sm"
              style={{ background: 'var(--color-primary-600)', color: '#fff', border: 'none' }}
              onClick={() => openAdjustmentModal()}
              disabled={isSavingAdjustment}
            >
              {isSavingAdjustment ? 'Procesando...' : 'Ajustar Stock'}
            </button>
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
                {viewMode === 'LOCAL' && (
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Acción</th>
                )}
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
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      <PermissionGuard allowedPermissions={['inventory:manage']}>
                         <button 
                            className="ghost-button button-sm" 
                            onClick={() => openAdjustmentModal(p.id)}
                            style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                         >
                            Ajustar
                         </button>
                      </PermissionGuard>
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

      {isAdjustmentModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--color-bg)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--color-slate-700)', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
               <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Ajustar Stock</h3>
               <button onClick={() => setIsAdjustmentModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--color-slate-400)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
            </div>
            
            <form onSubmit={handleSaveAdjustment}>
              {adjustmentError && <Banner tone="error">{adjustmentError}</Banner>}
              {adjustmentSuccess && <Banner tone="success">{adjustmentSuccess}</Banner>}
              
              <div className="stack-md" style={{ marginTop: adjustmentError || adjustmentSuccess ? '1rem' : '0' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--color-slate-900)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--color-slate-700)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600 }}>Productos a Ajustar</span>
                    <button type="button" onClick={addAdjustmentRow} className="ghost-button button-sm" style={{ padding: '0.25rem 0.5rem' }}>+ Añadir Fila</button>
                  </div>
                  {adjustmentRows.map((row, index) => (
                    <div key={row.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                      <label className="field" style={{ flex: 1 }}>
                        {index === 0 && <span style={{ fontSize: '0.75rem' }}>Producto</span>}
                        <select
                          value={row.productId}
                          onChange={(e) => updateRow(row.id, 'productId', e.target.value)}
                          required
                          style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--color-slate-700)', background: 'var(--color-slate-800)', color: 'white' }}
                        >
                          <option value="" disabled>Seleccione un producto</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.name} {p.barcode ? `(${p.barcode})` : ''} - (Stock: {balances[p.id] || 0})</option>
                          ))}
                        </select>
                      </label>
                      <label className="field" style={{ width: '100px' }}>
                        {index === 0 && <span style={{ fontSize: '0.75rem' }}>Cantidad</span>}
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={row.qtyChange}
                          onChange={(e) => updateRow(row.id, 'qtyChange', Number(e.target.value))}
                          required
                          style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--color-slate-700)', background: 'var(--color-slate-800)', color: 'white' }}
                        />
                      </label>
                      <div style={{ paddingTop: index === 0 ? '1.25rem' : '0' }}>
                        <button type="button" onClick={() => removeRow(row.id)} className="ghost-button" style={{ padding: '0.5rem', color: 'var(--color-error-500)' }} disabled={adjustmentRows.length === 1}>
                          &times;
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                  <label className="field">
                    <span style={{ fontWeight: 600 }}>Tipo de Ajuste General</span>
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
                </div>

                <label className="field">
                  <span style={{ fontWeight: 600 }}>Razón</span>
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
                  <span style={{ fontWeight: 600 }}>Notas (Opcional)</span>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Ej: Producto encontrado en bodega..."
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-slate-700)', background: 'var(--color-slate-800)', color: 'white' }}
                  />
                </label>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                  <button type="button" onClick={() => setIsAdjustmentModalOpen(false)} className="ghost-button">Cancelar</button>
                  <button 
                    type="submit" 
                    className="button" 
                    style={{ background: 'var(--color-primary-600)', color: '#fff', padding: '0.5rem 1.5rem' }} 
                    disabled={isSavingAdjustment || !!adjustmentSuccess}
                  >
                    {isSavingAdjustment ? 'Guardando...' : 'Confirmar Ajuste'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
