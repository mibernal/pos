import { useState, useMemo, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, ShellMessage, PlaceholderImage } from '../../components/ui';
import { PermissionGuard, useSession } from '../auth';

interface InventoryScreenProps {
  api: ReturnType<typeof import('../../lib/api').createApiClient>;
  branchId: string;
}

export function InventoryScreen({ api, branchId }: InventoryScreenProps) {
  const { role } = useSession();
  const isPlatformOwner = role === 'PLATFORM_OWNER';
  const isTenantAdmin = role === 'ADMIN' || role === 'TENANT_OWNER';
  const canSeeConsolidated = isPlatformOwner || isTenantAdmin || role === 'MANAGER' || role === 'AUDITOR';
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<'LOCAL' | 'CONSOLIDATED'>('LOCAL');
  
  // Adjustment Modal State
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [operation, setOperation] = useState<'MANUAL_ENTRY' | 'MANUAL_EXIT'>('MANUAL_ENTRY');

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
      
      const itemsToImport: Array<any> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
      
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
    <div className="flex flex-col h-full bg-muted/20 animate-in fade-in duration-300">
      <header className="flex-shrink-0 px-6 py-4 border-b border-border bg-background sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">Stock e Inventario</h2>
            <p className="text-sm text-muted-foreground mt-1">Control de entrada y salida de mercancía</p>
          </div>
          <PermissionGuard allowedPermissions={['inventory:adjust']}>
            <div className="flex flex-wrap items-center gap-3">
              {viewMode === 'LOCAL' && (
                <div className="flex items-center gap-2">
                  <button
                    className="inline-flex items-center justify-center h-9 px-3 rounded-md text-sm font-medium hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    onClick={handleExportCSV}
                  >
                    <span className="mr-2">📥</span> Exportar
                  </button>
                  <label className="inline-flex items-center justify-center h-9 px-3 rounded-md text-sm font-medium hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer m-0">
                    <span className="mr-2">📤</span> Importar
                    <input type="file" accept=".csv" className="hidden" onChange={e => void handleImportCSV(e)} />
                  </label>
                </div>
              )}
              <button
                className="inline-flex items-center justify-center h-9 px-4 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
                onClick={() => openAdjustmentModal()}
                disabled={isSavingAdjustment}
              >
                {isSavingAdjustment ? 'Procesando...' : 'Ajustar Stock'}
              </button>
              <div className="flex bg-muted p-1 rounded-lg border border-border/50">
                <button
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'LOCAL' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setViewMode('LOCAL')}
                >
                  Local
                </button>
                <button
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'CONSOLIDATED' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setViewMode('CONSOLIDATED')}
                >
                  Consolidado
                </button>
              </div>
            </div>
          </PermissionGuard>
        </div>
      </header>

      <main className="flex-1 p-6 w-full max-w-7xl mx-auto overflow-y-auto">
        {errorMessage && <Banner tone="error" className="mb-6">{errorMessage}</Banner>}

        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <span className="text-2xl">📦</span>
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">Sin productos</h3>
            <p className="text-muted-foreground max-w-md">
              Aún no has creado productos en esta sucursal. Crea un producto en el catálogo primero.
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="px-6 py-4 font-semibold text-muted-foreground w-16">Img</th>
                    <th className="px-6 py-4 font-semibold text-muted-foreground">Producto</th>
                    <th className="px-6 py-4 font-semibold text-muted-foreground">Categoría</th>
                    <th className="px-6 py-4 font-semibold text-muted-foreground text-right">
                      {viewMode === 'LOCAL' ? 'Stock Disponible' : 'Stock Total'}
                    </th>
                    {viewMode === 'LOCAL' && (
                      <th className="px-6 py-4 font-semibold text-muted-foreground text-right">Acción</th>
                    )}
                    {viewMode === 'CONSOLIDATED' && (
                      <th className="px-6 py-4 font-semibold text-muted-foreground">Desglose por Sucursal</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {viewMode === 'LOCAL' && products.map((p) => {
                    const qty = balances[p.id] || 0;
                    const isLowStock = qty <= 5;
                    const isOutOfStock = qty <= 0;

                    return (
                      <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="w-10 h-10 rounded-lg overflow-hidden border border-border bg-muted">
                            {p.imageUrl ? (
                              <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <PlaceholderImage name={p.name} category={p.category} size="sm" />
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-foreground">{p.name}</div>
                          {p.barcode && <div className="text-xs text-muted-foreground mt-0.5 font-mono">{p.barcode}</div>}
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">{p.category}</td>
                        <td className="px-6 py-4 text-right">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            isOutOfStock ? 'bg-destructive/10 text-destructive' : 
                            isLowStock ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' : 
                            'bg-green-500/10 text-green-600 dark:text-green-400'
                          }`}>
                            {qty} unds
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <PermissionGuard allowedPermissions={['inventory:adjust']}>
                             <button 
                                className="inline-flex items-center justify-center h-8 px-3 rounded-md text-xs font-medium border border-border bg-background hover:bg-muted hover:text-foreground transition-colors"
                                onClick={() => openAdjustmentModal(p.id)}
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
                      <tr key={p.product_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="w-10 h-10 rounded-lg overflow-hidden border border-border bg-muted">
                            {p.image_url ? (
                              <img src={p.image_url ?? undefined} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <PlaceholderImage name={p.product_name} category={p.category} size="sm" />
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-foreground">{p.product_name}</div>
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">{p.category}</td>
                        <td className="px-6 py-4 text-right">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            isOutOfStock ? 'bg-destructive/10 text-destructive' : 
                            isLowStock ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' : 
                            'bg-green-500/10 text-green-600 dark:text-green-400'
                          }`}>
                            {p.total_on_hand_qty} unds
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          <div className="flex flex-col gap-1">
                            {(p.branches_breakdown as Array<{ branch_id: string; branch_name: string; on_hand_qty: number }>).map((b) => (
                              <div key={b.branch_id} className="flex justify-between items-center gap-4 border-b border-border/30 last:border-0 pb-1 last:pb-0">
                                <span>{b.branch_name}:</span>
                                <strong className="text-foreground">{b.on_hand_qty}</strong>
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
          </div>
        )}

        {/* Modal */}
        {isAdjustmentModalOpen && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-card border border-border shadow-xl rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                 <h3 className="text-lg font-bold text-foreground">Ajustar Stock</h3>
                 <button 
                   onClick={() => setIsAdjustmentModalOpen(false)}
                   className="text-muted-foreground hover:text-foreground hover:bg-muted p-1 rounded-md transition-colors"
                 >
                   <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
              </div>
              
              <div className="p-6 overflow-y-auto">
                <form onSubmit={handleSaveAdjustment} className="flex flex-col gap-6">
                  {adjustmentError && <Banner tone="error">{adjustmentError}</Banner>}
                  {adjustmentSuccess && <Banner tone="success">{adjustmentSuccess}</Banner>}
                  
                  <div className="bg-muted/30 border border-border rounded-xl p-5">
                    <div className="flex justify-between items-center mb-4">
                      <span className="font-semibold text-foreground text-sm uppercase tracking-wider">Productos a Ajustar</span>
                      <button 
                        type="button" 
                        onClick={addAdjustmentRow} 
                        className="inline-flex items-center justify-center h-8 px-3 rounded-md text-xs font-medium bg-background border border-border hover:bg-muted transition-colors"
                      >
                        + Añadir Fila
                      </button>
                    </div>
                    
                    <div className="flex flex-col gap-3">
                      {adjustmentRows.map((row, index) => (
                        <div key={row.id} className="flex items-start gap-3">
                          <div className="flex-1 flex flex-col gap-1.5">
                            {index === 0 && <label className="text-xs font-medium text-muted-foreground">Producto</label>}
                            <select
                              value={row.productId}
                              onChange={(e) => updateRow(row.id, 'productId', e.target.value)}
                              required
                              className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <option value="" disabled>Seleccione un producto</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>{p.name} {p.barcode ? `(${p.barcode})` : ''} - (Stock: {balances[p.id] || 0})</option>
                              ))}
                            </select>
                          </div>
                          <div className="w-24 flex flex-col gap-1.5">
                            {index === 0 && <label className="text-xs font-medium text-muted-foreground">Cantidad</label>}
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={row.qtyChange}
                              onChange={(e) => updateRow(row.id, 'qtyChange', Number(e.target.value))}
                              required
                              className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                          </div>
                          <div className={`flex items-center ${index === 0 ? 'mt-6' : 'mt-1'}`}>
                            <button 
                              type="button" 
                              onClick={() => removeRow(row.id)} 
                              className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors" 
                              disabled={adjustmentRows.length === 1}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-foreground">Tipo de Ajuste General</label>
                    <select
                      value={operation}
                      onChange={(e) => setOperation(e.target.value as 'MANUAL_ENTRY' | 'MANUAL_EXIT')}
                      required
                      className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="MANUAL_ENTRY">Entrada (+)</option>
                      <option value="MANUAL_EXIT">Salida / Merma (-)</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-foreground">Razón</label>
                    <select
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required
                      className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-foreground">Notas (Opcional)</label>
                    <input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Ej: Producto encontrado en bodega..."
                      className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="flex justify-end gap-3 pt-4 border-t border-border mt-2">
                    <button 
                      type="button" 
                      onClick={() => setIsAdjustmentModalOpen(false)} 
                      className="h-10 px-4 inline-flex items-center justify-center rounded-md text-sm font-medium border border-border bg-background hover:bg-muted text-foreground transition-colors"
                    >
                      Cancelar
                    </button>
                    <button 
                      type="submit" 
                      className="h-10 px-4 inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
                      disabled={isSavingAdjustment || !!adjustmentSuccess}
                    >
                      {isSavingAdjustment ? 'Guardando...' : 'Confirmar Ajuste'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
