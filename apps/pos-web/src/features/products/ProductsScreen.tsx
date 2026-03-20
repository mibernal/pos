import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Banner, PlaceholderImage } from '../../components/ui';
import { formatMoneyFromCents } from '../../lib/format';
import type { ProductItem } from '../../lib/api';
import type { PosApiClient } from '../../types';
import { RoleGuard, useSession } from '../auth';
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
  const [priceCents, setPriceCents] = useState(1000);
  const [imageUrl, setImageUrl] = useState('');
  const [description, setDescription] = useState('');

  const isAdmin = role === 'ADMIN';
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
    setPriceCents(1000);
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
            price_cents: priceCents,
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
            price_cents: priceCents,
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
    setPriceCents(product.price_cents);
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
    <div className="products-layout">
      <section className="products-list-panel">
        <header className="section-heading">
          <div className="heading-copy">
            <h2>Catálogo de Productos</h2>
            <p>Gestiona los artículos disponibles para la venta</p>
          </div>
          <button className="ghost-button" style={{ padding: '0.5rem 1rem' }} onClick={() => void loadProducts()}>
            🔄 Sincronizar
          </button>
        </header>

        <div className="pos-search-toolbar" style={{ marginBottom: '1.5rem' }}>
          <div className="pos-search-field">
            <input
              placeholder="Buscar por nombre, categoría o código..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {query && (
            <button
              className="ghost-button"
              style={{ padding: '0 1rem' }}
              onClick={() => setQuery('')}
            >
              Limpiar
            </button>
          )}
        </div>

        {loading ? <Banner tone="info">Cargando productos...</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
        {message ? <Banner tone="success">{message}</Banner> : null}

        <div className="products-table">
          {products.length === 0 && !loading ? (
            <div className="empty-state">
              No se encontraron productos en esta sucursal.
            </div>
          ) : (
            products.map((product) => (
              <div key={product.id} className="product-row">
                <div style={{ width: '48px', height: '48px', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <PlaceholderImage name={product.name} category={product.category} size="sm" />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                    <strong style={{ fontSize: '1rem', color: 'var(--color-slate-900)' }}>{product.name}</strong>
                    <span className={`tag ${product.active ? 'tag-success' : 'tag-muted'}`} style={{ fontSize: '0.65rem' }}>
                      {product.active ? 'ACTIVO' : 'INACTIVO'}
                    </span>
                  </div>
                  <div className="subtle-text" style={{ fontSize: '0.8125rem', color: 'var(--color-slate-500)' }}>
                    <span style={{ color: 'var(--color-primary-600)', fontWeight: 600 }}>{product.category}</span>
                    <span style={{ margin: '0 0.5rem' }}>•</span>
                    <span>{getProductTaxCategoryLabel(product.taxCategory)}</span>
                    {product.barcode && (
                      <>
                        <span style={{ margin: '0 0.5rem' }}>•</span>
                        <code style={{ background: 'var(--color-slate-100)', padding: '0.1rem 0.3rem', borderRadius: '4px', fontSize: '0.75rem' }}>{product.barcode}</code>
                      </>
                    )}
                  </div>
                </div>
                <div className="product-row-right" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-slate-900)' }}>
                      {formatMoneyFromCents(product.price_cents)}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--color-slate-400)', textTransform: 'uppercase', letterSpacing: '0.025em' }}>Precio Base</span>
                  </div>
                  <RoleGuard allowedRoles={['ADMIN']}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="button button-sm ghost-button" style={{ padding: '0.4rem 0.8rem' }} onClick={() => startEdit(product)}>
                        Editar
                      </button>
                      <button
                        className="button button-sm ghost-button"
                        style={{ padding: '0.4rem 0.8rem', color: product.active ? 'var(--color-error-600)' : 'var(--color-success-600)' }}
                        onClick={() => void handleToggleActive(product.id)}
                      >
                        {product.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </RoleGuard>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <aside className="products-form-panel">
        <header className="section-heading" style={{ padding: '0 0 0.5rem' }}>
          <div className="heading-copy">
            <h3>{editingId ? 'Editar Producto' : 'Nuevo Producto'}</h3>
            <p>{editingId ? 'Modifica los detalles del item seleccionado' : 'Ingresa los datos para un nuevo artículo'}</p>
          </div>
          {/* Mobile toggle button */}
          <button
            type="button"
            className="ghost-button"
            style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem' }}
            onClick={() => setShowForm(f => !f)}
            aria-expanded={showForm}
          >
            {showForm ? '✕ Cerrar' : '+ Nuevo'}
          </button>
        </header>

        <RoleGuard
          allowedRoles={['ADMIN']}
          fallback={
            <div style={{ padding: '0 1rem' }}>
              <Banner tone="info">
                <strong>Modo Lectura</strong>
                <p style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>Como Cajero, puedes ver el catálogo pero no realizar modificaciones.</p>
              </Banner>
            </div>
          }
        >
          <form className="stack-md" style={{ padding: '0 0 1rem' }} onSubmit={handleSaveProduct}>
            <div className="field-group">
              <label className="field">
                <span>Nombre del Producto</span>
                <input 
                  placeholder="Ej. Café Espresso 250g" 
                  value={name} 
                  onChange={(event) => setName(event.target.value)} 
                  required 
                />
              </label>

              <label className="field">
                <span>Categoría</span>
                <input 
                  placeholder="Ej. Bebidas, Granos..." 
                  value={category} 
                  onChange={(event) => setCategory(event.target.value)} 
                  required 
                />
              </label>

              <label className="field">
                <span>Categoría Fiscal (Impuesto)</span>
                <select
                  value={taxCategory}
                  onChange={(event) => setTaxCategory(event.target.value as ProductTaxCategoryOption)}
                  required
                >
                  {PRODUCT_TAX_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Código de Barras</span>
                <input 
                  placeholder="Opcional" 
                  value={barcode} 
                  onChange={(event) => setBarcode(event.target.value)} 
                />
              </label>

              <label className="field">
                <span>Precio Unitario (¢)</span>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    placeholder="1000"
                    value={priceCents}
                    onChange={(event) => setPriceCents(Number(event.target.value))}
                    required
                    style={{ paddingRight: '4rem' }}
                  />
                  <span style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-400)' }}>CENTS</span>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '0.4rem' }}>
                  Equivale a <strong>{formatMoneyFromCents(priceCents)}</strong>
                </p>
              </label>

              <label className="field">
                <span>URL de Imagen</span>
                <input 
                  type="url"
                  placeholder="https://ejemplo.com/imagen.jpg" 
                  value={imageUrl} 
                  onChange={(event) => setImageUrl(event.target.value)} 
                />
                {imageUrl.trim() && (
                  <div className="image-preview" style={{ marginTop: '0.5rem' }}>
                    <img
                      src={imageUrl}
                      alt="Vista previa"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      onLoad={(e) => { (e.target as HTMLImageElement).style.display = 'block'; }}
                    />
                  </div>
                )}
              </label>

              <label className="field">
                <span>Descripción</span>
                <textarea 
                  placeholder="Detalles adicionales del producto..." 
                  value={description} 
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  style={{ resize: 'vertical' }}
                />
              </label>
            </div>

            <div className="row-actions" style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: editingId ? '1fr 1fr' : '1fr', gap: '0.75rem' }}>
              <button 
                type="submit" 
                className="button"
                style={{ background: 'var(--color-primary-600)', color: '#ffffff', padding: '0.75rem' }}
              >
                {editingId ? 'Guardar Cambios' : 'Crear Producto'}
              </button>
              {editingId && (
                <button 
                  className="ghost-button" 
                  type="button" 
                  onClick={resetForm}
                  style={{ padding: '0.75rem' }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </RoleGuard>
      </aside>
    </div>
  );
}
