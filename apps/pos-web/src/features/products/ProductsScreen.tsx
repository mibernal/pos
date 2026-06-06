import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Banner, PlaceholderImage } from '../../components/ui';
import { formatMoneyFromCents, pesosToCents, centsToPesos } from '../../lib/format';
import type { ProductItem } from '../../lib/api';
import type { PosApiClient } from '../../types';
import { PermissionGuard, useSession } from '../auth';
import {
  getProductTaxCategoryLabel,
  PRODUCT_TAX_CATEGORY_OPTIONS,
  type ProductTaxCategoryOption
} from './constants';

export function ProductsScreen({
  api,
  branchId
}: {
  api: PosApiClient;
  branchId: string;
}) {
  const { role } = useSession();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [taxCategory, setTaxCategory] = useState<ProductTaxCategoryOption>('IVA_19');
  const [barcode, setBarcode] = useState('');
  const [pricePesos, setPricePesos] = useState(1000);
  const [imageUrl, setImageUrl] = useState('');
  const [description, setDescription] = useState('');

  const isAdmin = role === 'ADMIN' || role === 'TENANT_OWNER';
  const [showForm, setShowForm] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.listProducts({
        query: query.trim() || undefined,
        limit: 120,
        branchId
      });
      setProducts(response.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No fue posible cargar productos');
    } finally {
      setLoading(false);
    }
  }, [api, branchId, query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadProducts();
    }, 160);

    return () => window.clearTimeout(timeout);
  }, [loadProducts]);

  function resetForm() {
    setEditingId(null);
    setName('');
    setCategory('');
    setTaxCategory('IVA_19');
    setBarcode('');
    setPricePesos(1000);
    setImageUrl('');
    setDescription('');
    setShowForm(false);
  }

  async function handleSaveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      if (editingId) {
        await api.patchProduct(
          editingId,
          {
            name,
            category,
            taxCategory,
            barcode: barcode.trim() ? barcode : null,
            price_cents: pesosToCents(pricePesos),
            imageUrl: imageUrl.trim() ? imageUrl : null,
            description: description.trim() ? description : null
          },
          branchId
        );
        setMessage('Producto actualizado');
      } else {
        await api.createProduct(
          {
            branchId,
            name,
            category,
            taxCategory,
            barcode: barcode.trim() ? barcode : null,
            price_cents: pesosToCents(pricePesos),
            active: true,
            imageUrl: imageUrl.trim() ? imageUrl : null,
            description: description.trim() ? description : null
          },
          branchId
        );
        setMessage('Producto creado');
      }

      resetForm();
      await loadProducts();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No fue posible guardar producto');
    }
  }

  function startEdit(product: ProductItem) {
    setEditingId(product.id);
    setName(product.name);
    setCategory(product.category);
    setTaxCategory(product.taxCategory);
    setBarcode(product.barcode ?? '');
    setPricePesos(centsToPesos(product.price_cents));
    setImageUrl(product.imageUrl ?? '');
    setDescription(product.description ?? '');
    setShowForm(true);
  }

  async function handleToggleActive(productId: string) {
    if (!isAdmin) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      await api.toggleProductActive(productId, branchId);
      setMessage('Estado del producto actualizado');
      await loadProducts();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error ? toggleError.message : 'No fue posible cambiar el estado'
      );
    }
  }

  return (
    <div className="flex flex-col lg:flex-row h-full bg-muted/20 overflow-hidden animate-in fade-in duration-300 relative">
      <section className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="flex-shrink-0 px-6 py-4 border-b border-border bg-background sticky top-0 z-10 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 max-w-7xl mx-auto">
            <div>
              <h2 className="text-2xl font-bold text-foreground tracking-tight">Catálogo de Productos</h2>
              <p className="text-sm text-muted-foreground mt-1">Gestiona los artículos disponibles para la venta</p>
            </div>
            <div className="flex items-center gap-3">
              <button 
                className="inline-flex items-center justify-center h-9 px-4 rounded-md text-sm font-medium border border-border bg-background hover:bg-muted text-foreground transition-colors shadow-sm"
                onClick={() => void loadProducts()}
              >
                <span className="mr-2">🔄</span> Sincronizar
              </button>
              {/* Mobile toggle button */}
              <button
                type="button"
                className="lg:hidden inline-flex items-center justify-center h-9 px-4 rounded-md text-sm font-medium bg-primary text-primary-foreground shadow-sm"
                onClick={() => setShowForm(f => !f)}
                aria-expanded={showForm}
              >
                {showForm ? '✕ Cerrar Formulario' : '+ Nuevo Producto'}
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 max-w-7xl mx-auto w-full">
          <div className="bg-card border border-border rounded-xl p-4 mb-6 shadow-sm flex flex-col sm:flex-row gap-3 items-center relative">
            <div className="relative flex-1 w-full">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </span>
              <input
                placeholder="Buscar por nombre, categoría o código..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full h-10 pl-9 pr-4 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {query && (
              <button
                className="inline-flex items-center justify-center h-10 px-4 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={() => setQuery('')}
              >
                Limpiar
              </button>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {loading ? <Banner tone="info" className="mb-2">Cargando productos...</Banner> : null}
            {error ? <Banner tone="error" className="mb-2">{error}</Banner> : null}
            {message ? <Banner tone="success" className="mb-2">{message}</Banner> : null}
          </div>

          <div className="flex flex-col gap-3">
            {products.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center py-24 text-center border border-border border-dashed rounded-xl bg-card">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                  <span className="text-2xl">🛍️</span>
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Sin productos</h3>
                <p className="text-muted-foreground max-w-md">
                  No se encontraron productos en esta sucursal. Ajusta los filtros o crea un nuevo producto.
                </p>
              </div>
            ) : (
              products.map((product) => (
                <div key={product.id} className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col sm:flex-row gap-4 sm:gap-5">
                  <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-xl overflow-hidden border border-border bg-muted flex-shrink-0">
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                    ) : (
                      <PlaceholderImage name={product.name} category={product.category} size="sm" />
                    )}
                  </div>
                  
                  <div className="flex-1 flex flex-col min-w-0 justify-between">
                    <div>
                      <div className="flex flex-wrap items-start gap-2 mb-1.5">
                        <strong className="text-lg sm:text-xl font-bold text-foreground truncate max-w-full">{product.name}</strong>
                        <span className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mt-1 sm:mt-0.5 ${
                          product.active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'
                        }`}>
                          {product.active ? 'ACTIVO' : 'INACTIVO'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-primary/10 text-primary font-medium text-xs">{product.category}</span>
                        <span className="hidden sm:inline text-border">•</span>
                        <span className="text-xs font-medium">{getProductTaxCategoryLabel(product.taxCategory)}</span>
                        {product.barcode && (
                          <>
                            <span className="hidden sm:inline text-border">•</span>
                            <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs text-foreground/80">Ref: {product.barcode}</code>
                          </>
                        )}
                      </div>
                      {product.description && (
                        <p className="mt-2 text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                          {product.description}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-4 sm:gap-3 flex-shrink-0 border-t sm:border-t-0 border-border pt-4 sm:pt-0 mt-2 sm:mt-0">
                    <div className="text-left sm:text-right">
                      <span className="block text-xl sm:text-2xl font-extrabold text-foreground tracking-tight">
                        {formatMoneyFromCents(product.price_cents)}
                      </span>
                      <span className="block text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mt-0.5">Precio Base</span>
                    </div>
                    <PermissionGuard allowedPermissions={['products:manage']}>
                      <div className="flex items-center gap-2 sm:mt-auto">
                        <button 
                          className="inline-flex items-center justify-center h-8 sm:h-9 px-3 sm:px-4 rounded-md text-xs sm:text-sm font-semibold border border-border bg-background hover:bg-muted text-foreground transition-colors shadow-sm"
                          onClick={() => {
                            startEdit(product);
                            setShowForm(true);
                          }}
                        >
                          Editar
                        </button>
                        <button
                          className={`inline-flex items-center justify-center h-8 sm:h-9 px-3 sm:px-4 rounded-md text-xs sm:text-sm font-semibold border transition-colors shadow-sm ${
                            product.active 
                              ? 'border-destructive/20 text-destructive hover:bg-destructive/10' 
                              : 'border-green-500/20 text-green-600 hover:bg-green-500/10'
                          }`}
                          onClick={() => void handleToggleActive(product.id)}
                        >
                          {product.active ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </PermissionGuard>
                  </div>
                </div>
              ))
            )}
          </div>
        </main>
      </section>

      {/* Form Sidebar Overlay for Mobile */}
      {showForm && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setShowForm(false)}
        />
      )}

      <aside className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[400px] bg-card border-l border-border shadow-2xl transform transition-transform duration-300 ease-in-out lg:relative lg:transform-none lg:w-96 flex flex-col h-full ${showForm ? 'translate-x-0' : 'translate-x-full lg:hidden'}`}>
        <header className="flex-shrink-0 px-6 py-4 border-b border-border bg-muted/30 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h3 className="text-lg font-bold text-foreground">{editingId ? 'Editar Producto' : 'Nuevo Producto'}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{editingId ? 'Modifica los detalles' : 'Ingresa los datos del artículo'}</p>
          </div>
          <button
            type="button"
            className="lg:hidden p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            onClick={() => setShowForm(false)}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </header>

        <PermissionGuard
          allowedPermissions={['products:manage']}
          fallback={
            <div className="p-6">
              <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm border border-destructive/20">
                No tienes permisos para gestionar productos.
              </div>
            </div>
          }
        >
          <div className="flex-1 overflow-y-auto p-6">
            <form onSubmit={handleSaveProduct} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-foreground">Nombre del Producto</label>
                <input 
                  placeholder="Ej. Café Espresso 250g" 
                  value={name} 
                  onChange={(event) => setName(event.target.value)} 
                  required 
                  className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-foreground">Categoría</label>
                <input 
                  placeholder="Ej. Bebidas, Granos..." 
                  value={category} 
                  onChange={(event) => setCategory(event.target.value)} 
                  required 
                  className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-foreground">Categoría Fiscal (Impuesto)</label>
                <select
                  value={taxCategory}
                  onChange={(event) => setTaxCategory(event.target.value as ProductTaxCategoryOption)}
                  required
                  className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {PRODUCT_TAX_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-foreground">Código de Barras</label>
                <input 
                  placeholder="Opcional" 
                  value={barcode} 
                  onChange={(event) => setBarcode(event.target.value)} 
                  className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-foreground">Precio Unitario</label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    step={100}
                    placeholder="1000"
                    value={pricePesos}
                    onChange={(event) => setPricePesos(Number(event.target.value))}
                    required
                    className="w-full h-10 pl-3 pr-12 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground pointer-events-none">COP</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-foreground">URL de Imagen</label>
                <div className="flex flex-col gap-2">
                  <input 
                    type="url"
                    placeholder="https://ejemplo.com/imagen.jpg" 
                    value={imageUrl} 
                    onChange={(event) => setImageUrl(event.target.value)} 
                    className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p className="text-[11px] text-muted-foreground">Pega aquí el enlace (URL) de la imagen del producto.</p>
                </div>
                {imageUrl.trim() && (
                  <div className="mt-3 w-full h-40 rounded-lg border border-border overflow-hidden bg-muted flex items-center justify-center relative group shadow-inner">
                    <img
                      src={imageUrl}
                      alt="Vista previa"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      onLoad={(e) => { (e.target as HTMLImageElement).style.display = 'block'; }}
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-white text-xs font-semibold bg-black/60 px-2 py-1 rounded">Vista previa</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-foreground">Descripción</label>
                <textarea 
                  placeholder="Detalles adicionales del producto..." 
                  value={description} 
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  className="w-full p-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                />
              </div>

              <div className="flex flex-col gap-3 mt-4 pt-4 border-t border-border">
                <button 
                  type="submit" 
                  className="w-full h-10 px-4 inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                >
                  {editingId ? 'Guardar Cambios' : 'Crear Producto'}
                </button>
                {editingId && (
                  <button 
                    type="button" 
                    onClick={resetForm}
                    className="w-full h-10 px-4 inline-flex items-center justify-center rounded-md text-sm font-medium border border-border bg-background hover:bg-muted text-foreground transition-colors"
                  >
                    Cancelar Edición
                  </button>
                )}
              </div>
            </form>
          </div>
        </PermissionGuard>
      </aside>
    </div>
  );
}
