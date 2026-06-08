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
        let usedCache = false;
        if (!forceRefresh) {
          const lastSync = await getLastSyncTime('products', branchId);
          // Increase freshness validation, but still do background sync (stale-while-revalidate)
          const isFresh = lastSync && Date.now() - lastSync < 12 * 60 * 60 * 1000;
          if (isFresh) {
            const cachedP = await getCachedProducts();
            const cachedC = await getCachedCustomers();
            if (cachedP && cachedC) {
              setCachedProducts(cachedP);
              setCustomers(cachedC);
              usedCache = true;
              setProductsLoading(false);
              // We do NOT return here; we continue to fetch in the background to keep data fresh
            }
          }
        }

        if (!usedCache) {
          setProductsLoading(true);
        }

        try {
          const response = await api.listProducts({
            limit: 5000,
            branchId
          });
          const activeProducts = response.items.filter((item) => item.active);
          setCachedProducts(activeProducts); // Update UI with fresh data
          
          const custs = await api.listCustomers();
          setCustomers(custs);
          
          // Background caching - isolated so IDB failures don't break the UI
          Promise.all([
            setCachedProductsDb(activeProducts, branchId),
            setCachedCustomersDb(custs)
          ]).catch(cacheError => {
            console.error('Error saving to offline cache:', cacheError);
          });
          
        } catch (apiError) {
          // Si la red falla, y NO teníamos caché previo, intentamos leer la caché ahora.
          // Si ya teníamos caché previo (usedCache = true), simplemente ignoramos el error de red
          // y seguimos trabajando offline sin interrumpir al usuario.
          if (!usedCache) {
            try {
              const cachedP = await getCachedProducts();
              const cachedC = await getCachedCustomers();
              if (cachedP && cachedC) {
                setCachedProducts(cachedP);
                setCustomers(cachedC);
                console.warn('Cargando catálogo desde caché (Modo Offline) tras fallo de red');
              } else {
                throw apiError;
              }
            } catch (cacheError) {
              console.error('Error al intentar leer caché local tras fallo de red:', cacheError);
              throw apiError;
            }
          } else {
            console.warn('Sincronización en segundo plano falló, pero se mantiene la caché existente.', apiError);
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
