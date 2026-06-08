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

import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
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
    parkedCarts,
    discountCents,
    subtotalCents,
    cartQuantity,
    totalCents,
    addProduct,
    removeSelectedItem,
    updateCartQty,
    resetCartState,
    parkCart,
    restoreCart
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
  useBarcodeScanner({
    onScan: (rawBarcode: string) => {
      let qty = 1;
      let barcode = rawBarcode;
      const match = rawBarcode.match(/^(\d+)\*(.+)$/);
      if (match) {
        qty = parseInt(match[1] || '1', 10);
        barcode = match[2] || rawBarcode;
      }

      const product = cachedProducts.find((p) => p.barcode === barcode);
      if (product) {
        handleProductSelect(product, qty);
      } else {
        setSaleError(`Producto no encontrado para el código de barras: ${barcode}`);
      }
    }
  });

  const [variantSelectionQty, setVariantSelectionQty] = useState<number>(1);

  const handleProductSelect = useCallback((product: ProductItem, qty: number = 1) => {
    if (product.variants && product.variants.length > 0) {
      setVariantSelectionProduct(product);
      setVariantSelectionQty(qty);
    } else {
      addProduct(product, undefined, qty);
      setQuery('');
      searchInputRef.current?.focus();
    }
  }, [addProduct, setQuery]);

  const clearCart = useCallback(() => {
    resetCartState();
    setSaleError(null);
    setSaleMessage(null);
  }, [resetCartState, setSaleError, setSaleMessage]);

  function handlePrintLastSale() { // eslint-disable-line react-hooks/exhaustive-deps
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
      cude: null,
      isReprint: true
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
        cude: null,
        isReprint: true
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

      if (event.key === 'F4' || (event.key === ' ' && !isTypingTarget && !isSearchInput)) {
        event.preventDefault();
        if (canOpenCheckout && !checkoutLoading) {
          setSaleError(null);
          setIsCheckoutModalOpen(true);
        }
        return;
      }

      if (event.key === 'F9') {
        event.preventDefault();
        if (cartItems.length > 0) {
          parkCart();
          setSaleMessage('Venta pausada. Se ha puesto en espera.');
        }
        return;
      }

      if (event.key === 'F10') {
        event.preventDefault();
        if (parkedCarts.length > 0) {
          restoreCart(0);
          setSaleMessage('Venta recuperada de la espera.');
        }
        return;
      }

      if (event.key === 'F12') {
        event.preventDefault();
        if (lastPrintedSaleSnapshot) {
          handlePrintLastSale();
          setSaleMessage('Reimprimiendo última venta...');
        }
        return;
      }

      if (event.key === 'Enter') {
        if (isSearchInput && query.includes('*')) {
          const match = query.match(/^(\d+)\*(.+)$/);
          if (match) {
            const qty = parseInt(match[1] || '1', 10);
            const barcode = match[2] || '';
            const product = cachedProducts.find((p) => p.barcode === barcode);
            if (product) {
              event.preventDefault();
              handleProductSelect(product, qty);
              return;
            }
          }
        }

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
    handleProductSelect,
    cachedProducts,
    cartItems.length,
    handlePrintLastSale,
    lastPrintedSaleSnapshot,
    parkCart,
    parkedCarts.length,
    query,
    restoreCart,
    setSaleMessage
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
                  } else if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    const match = query.match(/^(\d+)\*(.+)$/);
                    if (match) {
                      const qty = parseInt(match[1] || '1', 10);
                      const barcode = match[2] || '';
                      const product = cachedProducts.find((p) => p.barcode === barcode);
                      if (product) {
                        handleProductSelect(product, qty);
                        return;
                      }
                    }
                    if (highlightedProduct) {
                      handleProductSelect(highlightedProduct);
                    }
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
            <div className="quick-product-main" style={{ 
              position: 'relative', 
              borderRadius: '16px', 
              overflow: 'hidden', 
              minHeight: '160px',
              display: 'flex',
              alignItems: 'stretch',
              padding: 0
            }}>
              {/* Full background image/placeholder */}
              <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
                {highlightedProduct.imageUrl ? (
                  <img src={highlightedProduct.imageUrl} alt={highlightedProduct.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <PlaceholderImage name={highlightedProduct.name} category={highlightedProduct.category} size="xl" style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                )}
              </div>
              
              {/* Dark overlay for contrast */}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(15,23,42,0.95) 0%, rgba(15,23,42,0.8) 40%, rgba(15,23,42,0.4) 100%)', zIndex: 2 }} />

              <div style={{ position: 'relative', zIndex: 3, display: 'flex', flex: 1, padding: '1.5rem', alignItems: 'center', gap: '1.5rem' }}>
                <div className="quick-product-copy" style={{ flex: 1, color: '#ffffff' }}>
                  <span style={{ 
                    display: 'inline-block', 
                    background: 'var(--color-primary-600)', 
                    color: '#ffffff', 
                    padding: '0.2rem 0.6rem', 
                    borderRadius: '1rem', 
                    fontSize: '0.7rem', 
                    fontWeight: 700, 
                    textTransform: 'uppercase', 
                    letterSpacing: '0.05em',
                    marginBottom: '0.5rem',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }}>
                    Destacado
                  </span>
                  <h3 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>{highlightedProduct.name}</h3>
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem', opacity: 0.9, fontSize: '0.875rem' }}>
                    <span>{highlightedProduct.category || 'S/C'}</span>
                    {highlightedProduct.barcode && <span style={{ opacity: 0.7 }}>Cod. {highlightedProduct.barcode}</span>}
                  </div>
                  {highlightedProduct.description && (
                    <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#cbd5e1', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {highlightedProduct.description}
                    </p>
                  )}
                </div>
                <div className="quick-product-actions" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.75rem' }}>
                  <strong style={{ fontSize: '2rem', color: '#4ade80', textShadow: '0 2px 4px rgba(0,0,0,0.5)', lineHeight: 1 }}>
                    {formatMoneyFromCents(highlightedProduct.price_cents)}
                  </strong>
                  <button
                    aria-label="Agregar destacado"
                    type="button"
                    style={{ 
                      background: '#ffffff', 
                      color: '#0f172a',
                      fontWeight: 700,
                      padding: '0.75rem 2rem',
                      borderRadius: '12px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '1rem',
                      boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.transform = 'none'; }}
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
          await processSale(cartItems, discountCents, subtotalCents, totalCents, payments, customerId);
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
            addProduct(variantSelectionProduct, variant, variantSelectionQty);
            setVariantSelectionProduct(null);
            setVariantSelectionQty(1);
            setQuery('');
            searchInputRef.current?.focus();
          }
        }}
      />
    </div>
  );
}
