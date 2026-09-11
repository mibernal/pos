import { useEffect, useState, type FormEvent, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, PlaceholderImage } from '../../components/ui';
import { formatMoneyFromCents, pesosToCents, centsToPesos } from '../../lib/format';
import type { ProductItem } from '../../lib/api';
import { PermissionGuard, useSession } from '../auth';
import {
  getProductTaxCategoryLabel,
  PRODUCT_TAX_CATEGORY_OPTIONS,
  type ProductTaxCategoryOption
} from './constants';
import { useApi } from '../auth';
import { inventoryKeys } from '../../shared/query-keys';

function mensajeDeError(causa: unknown, respaldo: string): string | null {
  if (!causa) {
    return null;
  }

  return causa instanceof Error ? causa.message : respaldo;
}

export function ProductsScreen({
  branchId
}: {
  branchId: string;
}) {
  const api = useApi();
  const { role, tenantId } = useSession();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [taxCategory, setTaxCategory] = useState<ProductTaxCategoryOption>('IVA_19');
  const [barcode, setBarcode] = useState('');
  const [pricePesos, setPricePesos] = useState(1000);
  const [description, setDescription] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const canManageProducts = role === 'ADMIN' || role === 'TENANT_OWNER' || role === 'MANAGER';
  const [showForm, setShowForm] = useState(false);

  /**
   * Lo que se teclea y lo que se busca son dos cosas distintas a propósito.
   *
   * Escribir «café» son cuatro pulsaciones; con el texto crudo en la clave serían cuatro
   * consultas al servidor y tres respuestas que nadie llega a leer. El término aplicado se
   * queda quieto mientras el dedo se mueve y solo cambia cuando para, así que la consulta
   * sale una vez por búsqueda y no una por tecla.
   */
  useEffect(() => {
    const temporizador = window.setTimeout(() => setAppliedQuery(query), 160);

    return () => window.clearTimeout(temporizador);
  }, [query]);

  const searchTerm = appliedQuery.trim();

  /**
   * El término alarga la clave del catálogo en vez de sustituirla: cada búsqueda es su propia
   * entrada en la caché, pero todas cuelgan de la del catálogo, así que invalidarlo tras una
   * escritura las alcanza a todas sin tener que enumerarlas.
   */
  const catalogoConsulta = useQuery({
    queryKey: [...inventoryKeys.products(tenantId, branchId), searchTerm],
    queryFn: () => api.listProducts({ query: searchTerm || undefined, limit: 120, branchId })
  });

  /**
   * La fábrica de claves no tiene una para la galería de un producto, así que se deriva de la
   * del catálogo: cuelga de él —invalidar el catálogo del comercio alcanza también a las
   * galerías— y consulta e invalidación salen de esta misma función. Escrita a mano en los
   * cuatro sitios que la necesitan, tarde o temprano una se escribiría mal.
   */
  const claveImagenes = (productId: string) =>
    [...inventoryKeys.products(tenantId), productId, 'imagenes'] as const;

  const imagenesConsulta = useQuery({
    queryKey: claveImagenes(editingId ?? ''),
    queryFn: () => api.getProductImages(editingId ?? ''),
    enabled: Boolean(editingId)
  });

  const invalidarCatalogo = () =>
    queryClient.invalidateQueries({ queryKey: inventoryKeys.products(tenantId, branchId) });

  /**
   * Tocar una imagen mueve dos listas: la galería del formulario y el catálogo, porque la
   * imagen principal es la que se ve en cada tarjeta del listado.
   */
  const invalidarImagenesYCatalogo = (productId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: claveImagenes(productId) }),
      invalidarCatalogo()
    ]);

  const crearProducto = useMutation({
    mutationFn: () =>
      api.createProduct(
        {
          branchId,
          name,
          category,
          taxCategory,
          barcode: barcode.trim() ? barcode : null,
          price_cents: pesosToCents(pricePesos),
          active: true,
          description: description.trim() ? description : null
        },
        branchId
      ),
    onSuccess: async (nuevo) => {
      setMessage('Producto creado');
      // El formulario no se cierra: recién creado es cuando se le suben las imágenes, y para
      // eso hace falta el id que acaba de devolver el servidor.
      setEditingId(nuevo.id);
      await invalidarCatalogo();
    }
  });

  const actualizarProducto = useMutation({
    mutationFn: (productId: string) =>
      api.patchProduct(
        productId,
        {
          name,
          category,
          taxCategory,
          barcode: barcode.trim() ? barcode : null,
          price_cents: pesosToCents(pricePesos),
          description: description.trim() ? description : null
        },
        branchId
      ),
    onSuccess: async () => {
      setMessage('Producto actualizado');
      resetForm();
      await invalidarCatalogo();
    }
  });

  const cambiarEstado = useMutation({
    mutationFn: (productId: string) => api.toggleProductActive(productId, branchId),
    onSuccess: async () => {
      setMessage('Estado del producto actualizado');
      await invalidarCatalogo();
    }
  });

  const subirImagen = useMutation({
    mutationFn: ({ productId, file }: { productId: string; file: File }) =>
      api.uploadProductImage(productId, file),
    onSuccess: (_imagen, { productId }) => invalidarImagenesYCatalogo(productId),
    // El input de archivo se limpia pase lo que pase: si no, elegir el mismo archivo otra vez
    // tras un fallo no dispara `change` y parece que el botón se ha roto.
    onSettled: () => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  });

  const eliminarImagen = useMutation({
    mutationFn: ({ productId, imageId }: { productId: string; imageId: string }) =>
      api.deleteProductImage(productId, imageId),
    onSuccess: (_vacio, { productId }) => invalidarImagenesYCatalogo(productId)
  });

  const marcarPrincipal = useMutation({
    mutationFn: ({ productId, imageId }: { productId: string; imageId: string }) =>
      api.setProductImagePrimary(productId, imageId),
    onSuccess: (_vacio, { productId }) => invalidarImagenesYCatalogo(productId)
  });

  const products = catalogoConsulta.data?.items ?? [];
  const loading = catalogoConsulta.isPending;
  const images = imagenesConsulta.data ?? [];
  const loadingImages =
    imagenesConsulta.isFetching ||
    subirImagen.isPending ||
    eliminarImagen.isPending ||
    marcarPrincipal.isPending;

  // Un solo banner para todos los fallos posibles. Manda el de la última acción del usuario:
  // taparla con el error de una carga de hace un rato despista.
  const error =
    mensajeDeError(crearProducto.error, 'No fue posible guardar producto') ??
    mensajeDeError(actualizarProducto.error, 'No fue posible guardar producto') ??
    mensajeDeError(cambiarEstado.error, 'No fue posible cambiar el estado') ??
    mensajeDeError(subirImagen.error, 'Error subiendo imagen') ??
    mensajeDeError(eliminarImagen.error, 'Error eliminando imagen') ??
    mensajeDeError(marcarPrincipal.error, 'Error actualizando imagen principal') ??
    (imagenesConsulta.error ? 'No se pudieron cargar las imágenes' : null) ??
    mensajeDeError(catalogoConsulta.error, 'No fue posible cargar productos');

  function resetForm() {
    setEditingId(null);
    setName('');
    setCategory('');
    setTaxCategory('IVA_19');
    setBarcode('');
    setPricePesos(1000);
    setDescription('');
    setShowForm(false);
  }

  function handleSaveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageProducts) return;

    setMessage(null);

    if (editingId) {
      actualizarProducto.mutate(editingId);
      return;
    }

    crearProducto.mutate();
  }

  function startEdit(product: ProductItem) {
    setEditingId(product.id);
    setName(product.name);
    setCategory(product.category);
    setTaxCategory(product.taxCategory);
    setBarcode(product.barcode ?? '');
    setPricePesos(centsToPesos(product.price_cents));
    setDescription(product.description ?? '');
    setShowForm(true);
  }

  function handleToggleActive(productId: string) {
    if (!canManageProducts) return;

    setMessage(null);
    cambiarEstado.mutate(productId);
  }

  // --- Image Handlers ---

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!editingId || !e.target.files || e.target.files.length === 0) return;

    const file = e.target.files[0];
    if (!file) return;

    subirImagen.mutate({ productId: editingId, file });
  }

  function handleDeleteImage(imageId: string) {
    if (!editingId) return;
    if (!confirm('¿Seguro que deseas eliminar esta imagen?')) return;

    eliminarImagen.mutate({ productId: editingId, imageId });
  }

  function handleSetPrimaryImage(imageId: string) {
    if (!editingId) return;

    marcarPrincipal.mutate({ productId: editingId, imageId });
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
                onClick={() => void catalogoConsulta.refetch()}
              >
                <span className="mr-2">🔄</span> Sincronizar
              </button>
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
                      <img src={product.imageUrl} loading="lazy" alt={product.name} className="w-full h-full object-cover" />
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

      <aside className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[450px] bg-card border-l border-border shadow-2xl transform transition-transform duration-300 ease-in-out lg:relative lg:transform-none lg:w-[450px] flex flex-col h-full ${showForm ? 'translate-x-0' : 'translate-x-full lg:hidden'}`}>
        <header className="flex-shrink-0 px-6 py-4 border-b border-border bg-muted/30 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h3 className="text-lg font-bold text-foreground">{editingId ? 'Editar Producto' : 'Nuevo Producto'}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{editingId ? 'Modifica los detalles e imágenes' : 'Ingresa los datos del artículo'}</p>
          </div>
          <button
            type="button"
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            onClick={resetForm}
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

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-foreground">Categoría</label>
                  <input 
                    placeholder="Ej. Bebidas..." 
                    value={category} 
                    onChange={(event) => setCategory(event.target.value)} 
                    required 
                    className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-foreground">Impuesto</label>
                  <select
                    value={taxCategory}
                    onChange={(event) => setTaxCategory(event.target.value as ProductTaxCategoryOption)}
                    required
                    className="h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {PRODUCT_TAX_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
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
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-foreground">Descripción</label>
                <textarea 
                  placeholder="Detalles adicionales del producto..." 
                  value={description} 
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  className="w-full p-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                />
              </div>

              {/* IMAGES SECTION */}
              {editingId ? (
                <div className="flex flex-col gap-3 pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-foreground">Galería de Imágenes</label>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loadingImages}
                      className="text-xs font-medium bg-primary text-primary-foreground px-2 py-1 rounded hover:bg-primary/90 disabled:opacity-50"
                    >
                      + Agregar Imagen
                    </button>
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      className="hidden" 
                      accept="image/jpeg,image/png,image/webp" 
                      onChange={handleImageUpload}
                    />
                  </div>

                  {loadingImages ? (
                    <div className="text-xs text-muted-foreground text-center py-4">Actualizando imágenes...</div>
                  ) : images.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 mt-1">
                      {images.map(img => (
                        <div key={img.id} className={`relative group rounded-lg overflow-hidden border-2 transition-colors ${img.isPrimary ? 'border-primary' : 'border-border'}`}>
                          <div className="aspect-square bg-muted">
                            <img src={img.url} alt="Producto" loading="lazy" className="w-full h-full object-cover" />
                          </div>
                          
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                            {!img.isPrimary && (
                              <button
                                type="button"
                                onClick={() => handleSetPrimaryImage(img.id)}
                                className="w-full text-xs font-medium text-white bg-primary/80 hover:bg-primary rounded py-1"
                              >
                                Hacer Principal
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteImage(img.id)}
                              className="w-full text-xs font-medium text-white bg-destructive/80 hover:bg-destructive rounded py-1"
                            >
                              Eliminar
                            </button>
                          </div>
                          
                          {img.isPrimary && (
                            <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
                              Principal
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-lg bg-muted/20">
                      Aún no hay imágenes.
                    </div>
                  )}
                </div>
              ) : (
                <div className="pt-4 border-t border-border">
                  <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded-lg bg-muted/20">
                    Crea el producto primero para poder subir imágenes.
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3 mt-4 pt-4 border-t border-border">
                <button 
                  type="submit" 
                  className="w-full h-10 px-4 inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                >
                  {editingId ? 'Guardar Cambios' : 'Crear Producto'}
                </button>
              </div>
            </form>
          </div>
        </PermissionGuard>
      </aside>
    </div>
  );
}
