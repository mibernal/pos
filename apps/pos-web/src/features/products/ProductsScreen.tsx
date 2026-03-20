import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Banner } from '../../components/ui';
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

  const isAdmin = role === 'ADMIN';

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
            price_cents: priceCents
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
            active: true
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
        <div className="section-heading">
          <h2>Productos</h2>
          <button className="ghost-button" onClick={() => void loadProducts()}>
            Recargar
          </button>
        </div>

        <label className="field">
          <span>Buscar</span>
          <input
            placeholder="Nombre o código de barras"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {loading ? <Banner tone="info">Cargando productos...</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
        {message ? <Banner tone="success">{message}</Banner> : null}

        <div className="products-table">
          {products.map((product) => (
            <div key={product.id} className="product-row">
              <div>
                <strong>{product.name}</strong>
                <div className="subtle-text">
                  {product.category} • {getProductTaxCategoryLabel(product.taxCategory)}
                  {product.barcode ? ` • ${product.barcode}` : ''}
                </div>
              </div>
              <div className="product-row-right">
                <span>{formatMoneyFromCents(product.price_cents)}</span>
                <span className={`tag ${product.active ? 'tag-success' : 'tag-muted'}`}>
                  {product.active ? 'ACTIVO' : 'INACTIVO'}
                </span>
                <RoleGuard allowedRoles={['ADMIN']}>
                  <>
                    <button className="ghost-button" onClick={() => startEdit(product)}>
                      Editar
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => void handleToggleActive(product.id)}
                    >
                      Toggle
                    </button>
                  </>
                </RoleGuard>
              </div>
            </div>
          ))}
        </div>
      </section>

      <aside className="products-form-panel">
        <div className="section-heading">
          <h3>{editingId ? 'Editar producto' : 'Nuevo producto'}</h3>
        </div>
        <RoleGuard
          allowedRoles={['ADMIN']}
          fallback={<Banner tone="warning">Rol CASHIER: acceso de solo lectura al catálogo.</Banner>}
        >
          <form className="stack-md" onSubmit={handleSaveProduct}>
            <label className="field">
              <span>Nombre</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label className="field">
              <span>Categoría</span>
              <input value={category} onChange={(event) => setCategory(event.target.value)} required />
            </label>
            <label className="field">
              <span>Categoría fiscal</span>
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
              <span>Código de barras</span>
              <input value={barcode} onChange={(event) => setBarcode(event.target.value)} />
            </label>
            <label className="field">
              <span>Precio (centavos)</span>
              <input
                type="number"
                min={0}
                step={100}
                value={priceCents}
                onChange={(event) => setPriceCents(Number(event.target.value))}
                required
              />
            </label>
            <div className="row-actions">
              <button type="submit">{editingId ? 'Guardar cambios' : 'Crear producto'}</button>
              {editingId ? (
                <button className="ghost-button" type="button" onClick={resetForm}>
                  Cancelar
                </button>
              ) : null}
            </div>
          </form>
        </RoleGuard>
      </aside>
    </div>
  );
}
