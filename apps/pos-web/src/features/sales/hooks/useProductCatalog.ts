import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError, type Customer, type ProductItem } from '../../../lib/api';
import type { PosApiClient } from '../../../types';
import {
  getCachedProducts,
  getCachedCustomers,
  setCachedProducts as setCachedProductsDb,
  setCachedCustomers as setCachedCustomersDb,
  getLastSyncTime
} from '../../../lib/catalog-cache';

export interface UseProductCatalogOptions {
  api: PosApiClient;
  branchId: string;
}

export function useProductCatalog({ api, branchId }: UseProductCatalogOptions) {
  const [query, setQuery] = useState('');
  const [cachedProducts, setCachedProducts] = useState<ProductItem[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);

  const hasSearchQuery = query.trim().length > 0;

  const products = useMemo(() => {
    if (!hasSearchQuery) return cachedProducts;
    const q = query.trim().toLowerCase();
    return cachedProducts
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q))
      )
      .slice(0, 120);
  }, [cachedProducts, hasSearchQuery, query]);

  const highlightedProduct = useMemo(
    () => products.find((product) => product.id === highlightedProductId) ?? products[0] ?? null,
    [highlightedProductId, products]
  );

  const loadProducts = useCallback(
    async (forceRefresh = false) => {
      setProductsLoading(true);
      setProductsError(null);

      try {
        if (!forceRefresh) {
          const lastSync = await getLastSyncTime('products', branchId);
          const isFresh = lastSync && Date.now() - lastSync < 12 * 60 * 60 * 1000;
          if (isFresh) {
            const cachedP = await getCachedProducts();
            const cachedC = await getCachedCustomers();
            if (cachedP && cachedC) {
              setCachedProducts(cachedP);
              setCustomers(cachedC);
              setProductsLoading(false);
              return;
            }
          }
        }

        try {
          const response = await api.listProducts({
            limit: 5000,
            branchId
          });
          const activeProducts = response.items.filter((item) => item.active);
          setCachedProducts(activeProducts);
          await setCachedProductsDb(activeProducts, branchId);

          const custs = await api.listCustomers();
          setCustomers(custs);
          await setCachedCustomersDb(custs);
        } catch (apiError) {
          // Fallback a caché si la red falla (Offline First)
          try {
            const cachedP = await getCachedProducts();
            const cachedC = await getCachedCustomers();
            if (cachedP && cachedC) {
              setCachedProducts(cachedP);
              setCustomers(cachedC);
              console.warn('Cargando catálogo desde caché (Modo Offline)');
            } else {
              throw apiError; // Re-throw si no hay caché
            }
          } catch (cacheError) {
            console.error('Error al intentar leer caché local:', cacheError);
            throw apiError;
          }
        }
      } catch (loadError) {
        if (loadError instanceof ApiClientError && loadError.isNetworkError) {
          setProductsError('No hay conexión a internet y no hay catálogo guardado localmente.');
        } else {
          setProductsError(
            loadError instanceof Error ? loadError.message : 'No fue posible cargar productos o clientes'
          );
        }
      } finally {
        setProductsLoading(false);
      }
    },
    [api, branchId]
  );

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (products.length === 0) {
      setHighlightedProductId(null);
      return;
    }

    setHighlightedProductId((current) =>
      current && products.some((product) => product.id === current) ? current : products[0]!.id
    );
  }, [products]);

  const moveHighlightedProduct = useCallback(
    (direction: 'next' | 'previous') => {
      if (products.length === 0) {
        return;
      }

      const currentIndex = products.findIndex((product) => product.id === highlightedProduct?.id);
      const safeIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex =
        direction === 'next'
          ? (safeIndex + 1) % products.length
          : (safeIndex - 1 + products.length) % products.length;

      setHighlightedProductId(products[nextIndex]!.id);
    },
    [highlightedProduct?.id, products]
  );

  return {
    query,
    setQuery,
    hasSearchQuery,
    products,
    cachedProducts,
    customers,
    productsLoading,
    productsError,
    loadProducts,
    highlightedProduct,
    setHighlightedProductId,
    moveHighlightedProduct
  };
}
