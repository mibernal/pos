import { useCallback, useEffect, useRef } from 'react';
import { Banner, PlaceholderImage } from '../../components/ui';
import { formatMoneyFromCents } from '../../lib/format';
import { extractTicketPayments, printSaleTicket, printSaleTicketESCPOS } from '../../lib/ticket-printer';
import type { PendingSaleRecord } from '../../lib/offline-queue';
import type { TenantTaxMode, ProductItem } from '../../lib/api';
import type { TicketTemplateConfig } from '../../lib/ticket-template';
import type { PosApiClient, AppRoute, CartItem } from '../../types';
import { CheckoutModal, CartPanel, ProductGrid, CategoryGrid, VariantSelectorModal, SplitBillModal, SplitBillByProductsModal } from './components';
import { inferTaxModeFromSale } from './utils';
import { useState } from 'react';

import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
import { useBusinessModules } from '../../hooks/useBusinessModules';
import { useProductCatalog } from './hooks/useProductCatalog';
import { useCart } from './hooks/useCart';
import { useCheckout } from './hooks/useCheckout';
import { useTablesStore } from '../tables/store/useTablesStore';
import { useGetTableOrder, useSaveTableOrder, useClearTableOrder } from '../tables/api/tables.api';
import { TransferTableModal } from '../tables/components/TransferTableModal';

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
  onSyncPendingSales,
  onNavigate
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
  onNavigate?: (route: AppRoute) => void;
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
    moveHighlightedProduct,
    availableCategories,
    selectedCategory,
    setSelectedCategory
  } = useProductCatalog({ api, branchId });

  const { isRestaurantNative } = useBusinessModules();

  // Access active table if any
  const { activeTable, setActiveTable } = useTablesStore();

  const [viewMode, setViewMode] = useState<'categories' | 'products'>(
    isRestaurantNative ? 'categories' : 'products'
  );

  useEffect(() => {
    if (activeTable) {
      setViewMode('categories');
      setSelectedCategory(null);
    }
  }, [activeTable, setSelectedCategory]);

  const { data: tableOrderData, isLoading: isLoadingTableOrder } = useGetTableOrder(branchId, activeTable?.id);
  const { mutateAsync: saveTableOrder, isPending: isSavingTableOrder } = useSaveTableOrder();
  const { mutateAsync: clearTableOrder } = useClearTableOrder();

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
    restoreCart,
    setCartItems
  } = useCart();

  useEffect(() => {
    if (activeTable && activeTable.currentOrderId && tableOrderData && cartItems.length === 0) {
      const items: typeof cartItems = tableOrderData.items.map(i => ({
        productId: i.productId,
        variantId: i.variantId,
        name: i.productId, // We should lookup name from cachedProducts ideally, but minimal approach for now
        category: '',
        barcode: null,
        priceCents: i.priceCents,
        imageUrl: null,
        qty: i.qty
      }));
      // Map names from catalog if possible
      items.forEach(i => {
        const p = cachedProducts.find(cp => cp.id === i.productId);
        if (p) {
          i.name = p.name;
          i.category = p.category;
          i.barcode = p.barcode;
          i.imageUrl = p.imageUrl;
          if (i.variantId) {
            const v = p.variants?.find(v => v.id === i.variantId);
            if (v) i.variantName = v.name;
          }
        }
      });
      setCartItems(items);
    }
  }, [activeTable, tableOrderData, cartItems.length, setCartItems, cachedProducts]);

  const canOpenCheckout = cartItems.length > 0 && totalCents > 0;
  const hasPendingSales = pendingSales.length > 0;

  const [isSplitBillModalOpen, setIsSplitBillModalOpen] = useState(false);
  const [isSplitBillByProductsModalOpen, setIsSplitBillByProductsModalOpen] = useState(false);
  const [isTransferTableModalOpen, setIsTransferTableModalOpen] = useState(false);
  const [initialSplitParts, setInitialSplitParts] = useState<number | undefined>(undefined);
  const [checkoutOverrideItems, setCheckoutOverrideItems] = useState<CartItem[] | null>(null);
  const checkoutOverrideItemsRef = useRef<CartItem[] | null>(null);

  // Sync ref with state
  useEffect(() => {
    checkoutOverrideItemsRef.current = checkoutOverrideItems;
  }, [checkoutOverrideItems]);

  const checkoutItems = checkoutOverrideItems || cartItems;
  const currentSubtotalCents = checkoutOverrideItems ? checkoutItems.reduce((acc, i) => acc + (i.qty * i.priceCents), 0) : subtotalCents;
  const currentTotalCents = checkoutOverrideItems ? currentSubtotalCents : totalCents;
  const currentDiscountCents = checkoutOverrideItems ? 0 : discountCents;

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
    onSaleSuccess: async () => {
      if (checkoutOverrideItemsRef.current) {
         const overrideItems = checkoutOverrideItemsRef.current;
         // Refetch current cart items to be safe
         setCartItems(prev => {
           const newCartItems = [...prev];
           for (const item of overrideItems) {
              const index = newCartItems.findIndex(i => i.productId === item.productId && i.variantId === item.variantId);
              if (index !== -1) {
                 const existingItem = newCartItems[index];
                 if (existingItem) {
                   newCartItems[index] = { ...existingItem, qty: existingItem.qty - item.qty };
                   if (newCartItems[index]!.qty <= 0) {
                     newCartItems.splice(index, 1);
                   }
                 }
              }
           }
           
           if (activeTable) {
             saveTableOrder({
                branchId,
                tableId: activeTable.id,
                payload: { items: newCartItems.map(i => ({ productId: i.productId, variantId: i.variantId ?? null, qty: i.qty, priceCents: i.priceCents, lineTotalCents: i.qty * i.priceCents })) }
             }).catch(e => console.error('Failed to update table order after split bill', e));
           }

           return newCartItems;
         });
         
         setCheckoutOverrideItems(null);
      } else {
        resetCartState();
        searchInputRef.current?.focus();
        void loadProducts();
        if (activeTable) {
          try {
            await clearTableOrder({ branchId, tableId: activeTable.id });
            setActiveTable(null);
            onNavigate?.('tables');
          } catch (e) {
            console.error('Failed to clear table order', e);
          }
        }
      }
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
      tipCents: lastPrintedSaleSnapshot.sale.tip_cents ?? 0,
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
        tipCents: lastPrintedSaleSnapshot.sale.tip_cents ?? 0,
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
            <h2>{activeTable ? `Mesa: ${activeTable.name}` : 'Panel de Ventas'}</h2>
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
          {activeTable && (
            <div style={{ marginLeft: '1rem' }}>
              <button
                className="primary-button"
                style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                disabled={cartItems.length === 0 || isSavingTableOrder}
                onClick={async () => {
                  try {
                    await saveTableOrder({
                      branchId,
                      tableId: activeTable.id,
                      payload: {
                        items: cartItems.map(item => ({
                          productId: item.productId,
                          variantId: item.variantId,
                          qty: item.qty,
                          priceCents: item.priceCents,
                          lineTotalCents: item.priceCents * item.qty
                        }))
                      }
                    });
                    setSaleMessage(`Pedido guardado en mesa ${activeTable.name}`);
                    setTimeout(() => {
                      setActiveTable(null);
                      onNavigate?.('tables');
                    }, 1500);
                  } catch (e) {
                    setSaleError('Error al guardar en la mesa');
                  }
                }}
              >
                {isSavingTableOrder ? 'Guardando...' : '💾 Guardar en Mesa'}
              </button>
            </div>
          )}
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


        {selectedCategory && !hasSearchQuery && (
          <div style={{ marginBottom: '1rem', padding: '0 0.5rem' }}>
            <button
              onClick={() => setSelectedCategory(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-primary-600)',
                fontWeight: 600,
                fontSize: '1rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0'
              }}
            >
              ⬅ Volver a Categorías
            </button>
            <h3 style={{ margin: '0.5rem 0 1rem 0', fontSize: '1.5rem', fontWeight: 700 }}>
              {selectedCategory}
            </h3>
          </div>
        )}

        {!hasSearchQuery && !selectedCategory && availableCategories.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', padding: '0 0.5rem' }}>
            <button 
              className={viewMode === 'categories' ? 'primary-button' : 'secondary-button'} 
              onClick={() => setViewMode('categories')}
              style={{ padding: '0.5rem 1rem', borderRadius: 'var(--radius-full)', flex: 1 }}
            >
              🗂 Categorías
            </button>
            <button 
              className={viewMode === 'products' ? 'primary-button' : 'secondary-button'} 
              onClick={() => setViewMode('products')}
              style={{ padding: '0.5rem 1rem', borderRadius: 'var(--radius-full)', flex: 1 }}
            >
              📦 Todos los Productos
            </button>
          </div>
        )}

        {!hasSearchQuery && !selectedCategory && viewMode === 'categories' ? (
          <CategoryGrid 
            categories={availableCategories} 
            onSelectCategory={setSelectedCategory} 
          />
        ) : (
          <ProductGrid
            products={products}
            productsLoading={productsLoading}
            hasSearchQuery={hasSearchQuery}
            highlightedProductId={highlightedProduct?.id ?? null}
            setHighlightedProductId={setHighlightedProductId}
            addProduct={(p) => handleProductSelect(p)}
          />
        )}
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

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            {activeTable && canOpenCheckout ? (
              <>
                <button
                  className="secondary-button"
                  disabled={checkoutLoading || isSavingTableOrder}
                  onClick={() => setIsTransferTableModalOpen(true)}
                  style={{ flex: 1, padding: '1rem', borderRadius: '8px' }}
                >
                  Cambio de Mesa
                </button>
                <button
                  className="secondary-button"
                  disabled={checkoutLoading || isSavingTableOrder}
                  onClick={() => {
                    setSaleError(null);
                    setIsSplitBillModalOpen(true);
                  }}
                  style={{ flex: 1, padding: '1rem', borderRadius: '8px' }}
                >
                  Dividir Cuenta
                </button>
              </>
            ) : null}
            <button
              className={`checkout-button ${canOpenCheckout ? 'is-active' : ''}`}
              disabled={!canOpenCheckout || checkoutLoading}
              style={{ flex: 2, padding: '1rem', borderRadius: '8px' }}
              onClick={() => {
                setSaleError(null);
                setInitialSplitParts(undefined);
                setCheckoutOverrideItems(null);
                setIsCheckoutModalOpen(true);
              }}
            >
              {checkoutLoading ? 'Procesando...' : `Cobrar ${formatMoneyFromCents(totalCents)} (F12)`}
            </button>
          </div>
        </div>
      </div>

      <CheckoutModal
        isOpen={isCheckoutModalOpen}
        onClose={() => {
          setIsCheckoutModalOpen(false);
          setInitialSplitParts(undefined);
          setCheckoutOverrideItems(null);
        }}
        cartItems={checkoutItems}
        totalCents={currentTotalCents}
        discountCents={currentDiscountCents}
        customers={customers}
        initialSplitParts={initialSplitParts}
        onConfirm={async (payments, customerId, tipCents) => {
          await processSale(checkoutItems, currentDiscountCents, tipCents ?? 0, currentSubtotalCents, currentTotalCents, payments, customerId, activeTable?.currentOrderId);
        }}
        isSubmitting={checkoutLoading}
        error={saleError}
      />

      <SplitBillModal
        isOpen={isSplitBillModalOpen}
        onClose={() => setIsSplitBillModalOpen(false)}
        cartItems={cartItems}
        totalCents={totalCents}
        onSelectMode={(mode, payload) => {
          setIsSplitBillModalOpen(false);
          if (mode === 'EQUAL') {
            setInitialSplitParts(payload.parts);
            setIsCheckoutModalOpen(true);
          } else if (mode === 'PERCENTAGE') {
            setInitialSplitParts(undefined);
            setIsCheckoutModalOpen(true);
          } else if (mode === 'PRODUCTS') {
            setIsSplitBillByProductsModalOpen(true);
          }
        }}
      />

      <SplitBillByProductsModal
        isOpen={isSplitBillByProductsModalOpen}
        onClose={() => setIsSplitBillByProductsModalOpen(false)}
        cartItems={cartItems}
        onConfirm={(selectedItems) => {
          setIsSplitBillByProductsModalOpen(false);
          setCheckoutOverrideItems(selectedItems);
          setIsCheckoutModalOpen(true);
        }}
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

      {activeTable && (
        <TransferTableModal
          isOpen={isTransferTableModalOpen}
          onClose={() => setIsTransferTableModalOpen(false)}
          sourceTable={activeTable}
          items={tableOrderData?.items || []}
          onTransferComplete={() => {
            setIsTransferTableModalOpen(false);
            setActiveTable(null);
            onNavigate?.('tables');
          }}
        />
      )}
    </div>
  );
}
