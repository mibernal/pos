import { useCallback, useEffect, useRef } from 'react';
import { Banner, PlaceholderImage } from '../../components/ui';
import { formatMoneyFromCents } from '../../lib/format';
import { extractTicketPayments, printSaleTicket, printSaleTicketESCPOS } from '../../lib/ticket-printer';
import type { PendingSaleRecord } from '../../lib/offline-queue';
import type { TenantTaxMode, ProductItem } from '../../lib/api';
import type { TicketTemplateConfig } from '../../lib/ticket-template';
import type { PosApiClient } from '../../types';
import { CheckoutModal, CartPanel, ProductGrid, VariantSelectorModal } from './components';
import { inferTaxModeFromSale } from './utils';
import { useState } from 'react';

import { useBarcodeScanner } from './hooks/useBarcodeScanner';
import { useProductCatalog } from './hooks/useProductCatalog';
import { useCart } from './hooks/useCart';
import { useCheckout } from './hooks/useCheckout';

export function PosScreen({
  api,
  branchId,
  cashSessionId,
  branchName,
  branchAddress,
  isOnline: _isOnline = true,
  pendingSales = [],
  syncingPendingSales = false,
  syncingPendingSaleIds: _syncingPendingSaleIds = [],
  ticketTemplate,
  tenantTaxMode,
  onRetryPendingSale: _onRetryPendingSale,
  onSaleQueued,
  onSyncPendingSales
}: {
  api: PosApiClient;
  branchId: string;
  cashSessionId: string;
  branchName: string;
  branchAddress?: string;
  isOnline?: boolean;
  pendingSales?: PendingSaleRecord[];
  syncingPendingSales?: boolean;
  syncingPendingSaleIds?: string[];
  ticketTemplate: TicketTemplateConfig;
  tenantTaxMode?: TenantTaxMode | null;
  onRetryPendingSale?: (recordId: string) => Promise<void> | void;
  onSaleQueued: () => Promise<void> | void;
  onSyncPendingSales?: () => Promise<void> | void;
}) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [variantSelectionProduct, setVariantSelectionProduct] = useState<ProductItem | null>(null);

  // 1. Catalog Hook
  const {
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
  } = useProductCatalog({ api, branchId });

  // 2. Cart Hook
  const {
    cartItems,
    selectedCartIndex,
    setSelectedCartIndex,
    discountCents,
    subtotalCents,
    cartQuantity,
    totalCents,
    addProduct,
    removeSelectedItem,
    updateCartQty,
    resetCartState
  } = useCart();

  const canOpenCheckout = cartItems.length > 0 && totalCents > 0;
  const hasPendingSales = pendingSales.length > 0;

  // 3. Checkout Hook
  const {
    isCheckoutModalOpen,
    setIsCheckoutModalOpen,
    checkoutLoading,
    saleError,
    setSaleError,
    saleMessage,
    setSaleMessage,
    lastPrintedSaleSnapshot,
    processSale
  } = useCheckout({
    api,
    branchId,
    cashSessionId,
    onSaleSuccess: () => {
      resetCartState();
      searchInputRef.current?.focus();
      void loadProducts();
    },
    onSaleQueued: async () => {
      await onSaleQueued();
    }
  });

  // HW Scanner Support
  useBarcodeScanner((barcode) => {
    const product = cachedProducts.find((p) => p.barcode === barcode);
    if (product) {
      if (product.variants && product.variants.length > 0) {
        setVariantSelectionProduct(product);
      } else {
        addProduct(product);
        setSaleError(null);
        setQuery('');
        searchInputRef.current?.focus();
      }
    } else {
      setSaleError(`Producto no encontrado (${barcode})`);
    }
  });

  const handleProductSelect = useCallback((product: ProductItem) => {
    if (product.variants && product.variants.length > 0) {
      setVariantSelectionProduct(product);
    } else {
      addProduct(product);
      setQuery('');
      searchInputRef.current?.focus();
    }
  }, [addProduct, setQuery]);

  const clearCart = useCallback(() => {
    resetCartState();
    setSaleError(null);
    setSaleMessage(null);
  }, [resetCartState, setSaleError, setSaleMessage]);

  function handlePrintLastSale() {
    if (!lastPrintedSaleSnapshot) return;

    printSaleTicket({
      template: ticketTemplate,
      branchName,
      branchAddress,
      saleNumber: lastPrintedSaleSnapshot.sale.sale_number,
      createdAt: lastPrintedSaleSnapshot.sale.created_at,
      saleStatus: lastPrintedSaleSnapshot.sale.status,
      items: lastPrintedSaleSnapshot.items,
      subtotalCents: lastPrintedSaleSnapshot.sale.subtotal_cents,
      discountCents: lastPrintedSaleSnapshot.sale.discount_cents,
      totalCents: lastPrintedSaleSnapshot.sale.total_cents,
      payments: extractTicketPayments(lastPrintedSaleSnapshot.sale.payment_json),
      taxMode: tenantTaxMode ?? inferTaxModeFromSale(lastPrintedSaleSnapshot.sale),
      dianStatus: lastPrintedSaleSnapshot.sale.dian_status ?? 'PENDING',
      voidReason: lastPrintedSaleSnapshot.sale.void_reason,
      voidedAt: lastPrintedSaleSnapshot.sale.voided_at,
      cude: null
    });
  }

  async function handlePrintLastSaleESCPOS() {
    if (!lastPrintedSaleSnapshot) return;

    try {
      await printSaleTicketESCPOS({
        template: ticketTemplate,
        branchName,
        branchAddress,
        saleNumber: lastPrintedSaleSnapshot.sale.sale_number,
        createdAt: lastPrintedSaleSnapshot.sale.created_at,
        saleStatus: lastPrintedSaleSnapshot.sale.status,
        items: lastPrintedSaleSnapshot.items,
        subtotalCents: lastPrintedSaleSnapshot.sale.subtotal_cents,
        discountCents: lastPrintedSaleSnapshot.sale.discount_cents,
        totalCents: lastPrintedSaleSnapshot.sale.total_cents,
        payments: extractTicketPayments(lastPrintedSaleSnapshot.sale.payment_json),
        taxMode: tenantTaxMode ?? inferTaxModeFromSale(lastPrintedSaleSnapshot.sale),
        dianStatus: lastPrintedSaleSnapshot.sale.dian_status ?? 'PENDING',
        voidReason: lastPrintedSaleSnapshot.sale.void_reason,
        voidedAt: lastPrintedSaleSnapshot.sale.voided_at,
        cude: null
      });
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : 'Error al imprimir ESC/POS');
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isCheckoutModalOpen) return;

      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;
      const isSearchInput = target === searchInputRef.current;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isSearchInput && event.key === 'ArrowDown') {
        event.preventDefault();
        moveHighlightedProduct('next');
        return;
      }

      if (isSearchInput && event.key === 'ArrowUp') {
        event.preventDefault();
        moveHighlightedProduct('previous');
        return;
      }

      if (event.key === 'F12') {
        event.preventDefault();
        if (canOpenCheckout && !checkoutLoading) {
          setSaleError(null);
          setIsCheckoutModalOpen(true);
        }
        return;
      }

      if (event.key === 'Enter') {
        if (isSearchInput && highlightedProduct) {
          event.preventDefault();
          handleProductSelect(highlightedProduct);
          return;
        }

        if (isTypingTarget) return;

        event.preventDefault();
        if (canOpenCheckout && !checkoutLoading) {
          setSaleError(null);
          setIsCheckoutModalOpen(true);
        }
        return;
      }

      if (event.key === 'Delete') {
        if (isTypingTarget) return;
        event.preventDefault();
        removeSelectedItem();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    addProduct,
    canOpenCheckout,
    checkoutLoading,
    highlightedProduct,
    isCheckoutModalOpen,
    moveHighlightedProduct,
    removeSelectedItem,
    setQuery,
    setSaleError,
    setIsCheckoutModalOpen,
    handleProductSelect
  ]);

  return (
    <div className="pos-screen">
      <section className="products-panel">
        <header className="section-heading pos-heading">
          <div className="heading-copy">
            <h2>Panel de Ventas</h2>
            <p>Búsqueda rápida y catálogo táctil</p>
          </div>
          <div className="pos-metrics">
            <div className="metric-card">
              <span>Items</span>
              <strong>{cartQuantity}</strong>
            </div>
            <div className="metric-card">
              <span>Artículos</span>
              <strong>{products.length}</strong>
            </div>
            <div className="metric-card" style={{ background: 'var(--color-primary-600)', borderColor: 'var(--color-primary-700)' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>Total</span>
              <strong style={{ color: '#ffffff' }}>{formatMoneyFromCents(totalCents)}</strong>
            </div>
          </div>
        </header>

        <div className="pos-search-panel">
          <div className="pos-search-toolbar">
            <div className="pos-search-field">
              <input
                aria-label="Búsqueda rápida"
                ref={searchInputRef}
                placeholder="Escanea o busca un producto... (Ctrl+K)"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    event.stopPropagation();
                    moveHighlightedProduct('next');
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    event.stopPropagation();
                    moveHighlightedProduct('previous');
                  } else if (event.key === 'Enter' && highlightedProduct) {
                    event.preventDefault();
                    event.stopPropagation();
                    addProduct(highlightedProduct);
                    setQuery('');
                  }
                }}
              />
            </div>
            {hasSearchQuery && (
              <button
                className="ghost-button"
                style={{ padding: '0 1rem' }}
                onClick={() => {
                  setQuery('');
                  searchInputRef.current?.focus();
                }}
              >
                Limpiar
              </button>
            )}
          </div>

          <div className="pos-keyboard-hint">
            <span className="hint-chip"><kbd>Ctrl</kbd>+<kbd>K</kbd> Buscar</span>
            <span className="hint-chip"><kbd>↑</kbd><kbd>↓</kbd> Navegar</span>
            <span className="hint-chip"><kbd>Enter</kbd> Agregar</span>
            <span className="hint-chip"><kbd>F12</kbd> Cobrar</span>
          </div>
        </div>

        {productsLoading && <Banner tone="info">Cargando catálogo de productos...</Banner>}
        {productsError && <Banner tone="error">{productsError}</Banner>}

        <div className="quick-product-card">
          {highlightedProduct ? (
            <div className="quick-product-main">
              <div style={{ width: '100px', height: '100px', borderRadius: '12px', overflow: 'hidden', flexShrink: 0, boxShadow: 'var(--shadow-sm)' }}>
                {highlightedProduct.imageUrl ? (
                  <img src={highlightedProduct.imageUrl} alt={highlightedProduct.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <PlaceholderImage name={highlightedProduct.name} category={highlightedProduct.category} size="lg" />
                )}
              </div>
              <div className="quick-product-copy" style={{ flex: 1 }}>
                <span className="tag tag-info" style={{ marginBottom: '0.5rem' }}>Destacado</span>
                <h3>{highlightedProduct.name}</h3>
                <div className="quick-product-meta">
                  <span>{highlightedProduct.category}</span>
                  {highlightedProduct.barcode && <span className="tag-muted">Cod. {highlightedProduct.barcode}</span>}
                </div>
                {highlightedProduct.description && (
                  <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: 'var(--color-slate-500)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {highlightedProduct.description}
                  </p>
                )}
              </div>
              <div className="quick-product-actions">
                <strong>{formatMoneyFromCents(highlightedProduct.price_cents)}</strong>
                <button
                  aria-label="Agregar destacado"
                  type="button"
                  className="quick-product-button"
                  style={{ background: 'var(--color-primary-600)', padding: '0.75rem 2rem' }}
                  onClick={() => {
                    addProduct(highlightedProduct);
                    setQuery('');
                    searchInputRef.current?.focus();
                  }}
                >
                  Agregar (Enter)
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-slate-500)' }}>
              {hasSearchQuery
                ? 'No se encontraron productos coincidentes.'
                : 'Usa la búsqueda o selecciona un producto del catálogo.'}
            </div>
          )}
        </div>

        <ProductGrid
          products={products}
          productsLoading={productsLoading}
          hasSearchQuery={hasSearchQuery}
          highlightedProductId={highlightedProduct?.id ?? null}
          setHighlightedProductId={setHighlightedProductId}
          addProduct={(p) => handleProductSelect(p)}
        />
      </section>

      <CartPanel
        cartItems={cartItems}
        cartQuantity={cartQuantity}
        selectedCartIndex={selectedCartIndex}
        clearCart={clearCart}
        setSelectedCartIndex={setSelectedCartIndex}
        updateCartQty={updateCartQty}
        removeCartItem={(index) => {
          setSelectedCartIndex(index);
          removeSelectedItem();
        }}
      />

      <div className="pos-footer">
        {hasPendingSales && (
          <div className="sync-banner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{pendingSales.length} {pendingSales.length === 1 ? 'venta offline pendiente' : 'ventas offline pendientes'}</strong>
              <p>Sincroniza cuando tengas conexión estable.</p>
            </div>
            {onSyncPendingSales && (
              <button
                className="secondary-button"
                onClick={() => void onSyncPendingSales()}
                disabled={syncingPendingSales}
              >
                {syncingPendingSales ? 'Sincronizando...' : 'Sincronizar ahora'}
              </button>
            )}
          </div>
        )}

        {saleError && (
          <Banner tone="error" onClose={() => setSaleError(null)}>
            {saleError}
          </Banner>
        )}
        {saleMessage && (
          <Banner tone="success" onClose={() => setSaleMessage(null)}>
            {saleMessage}
          </Banner>
        )}
        {lastPrintedSaleSnapshot && (
          <Banner
            tone="info"
            action={
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="secondary-button" onClick={handlePrintLastSale}>
                  Imprimir HTML
                </button>
                {'serial' in navigator && (
                  <button className="secondary-button" onClick={() => void handlePrintLastSaleESCPOS()}>
                    Imprimir ESC/POS
                  </button>
                )}
              </div>
            }
          >
            Venta registrada exitosamente.
          </Banner>
        )}

        <div className="pos-totals">
          <div className="pos-totals-row">
            <span>Subtotal</span>
            <span>{formatMoneyFromCents(subtotalCents)}</span>
          </div>
          <div className="pos-totals-row">
            <span>Descuento</span>
            <span>-{formatMoneyFromCents(discountCents)}</span>
          </div>
          <div className="pos-totals-row is-total">
            <span>Total a Pagar</span>
            <span>{formatMoneyFromCents(totalCents)}</span>
          </div>

          <button
            className={`checkout-button ${canOpenCheckout ? 'is-active' : ''}`}
            disabled={!canOpenCheckout || checkoutLoading}
            onClick={() => {
              setSaleError(null);
              setIsCheckoutModalOpen(true);
            }}
          >
            {checkoutLoading ? 'Procesando...' : `Cobrar ${formatMoneyFromCents(totalCents)} (F12)`}
          </button>
        </div>
      </div>

      <CheckoutModal
        isOpen={isCheckoutModalOpen}
        onClose={() => setIsCheckoutModalOpen(false)}
        cartItems={cartItems}
        totalCents={totalCents}
        discountCents={discountCents}
        customers={customers}
        onConfirm={async (payments, customerId) => {
          await processSale(cartItems, discountCents, payments, customerId);
        }}
        isSubmitting={checkoutLoading}
        error={saleError}
      />

      <VariantSelectorModal
        isOpen={!!variantSelectionProduct}
        product={variantSelectionProduct}
        onClose={() => setVariantSelectionProduct(null)}
        onSelect={(variant) => {
          if (variantSelectionProduct) {
            addProduct(variantSelectionProduct, variant);
            setVariantSelectionProduct(null);
            setQuery('');
            searchInputRef.current?.focus();
          }
        }}
      />
    </div>
  );
}
