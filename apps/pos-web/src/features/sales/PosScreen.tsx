import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner, PlaceholderImage } from '../../components/ui';
import { formatMoneyFromCents } from '../../lib/format';
import { addPendingSale } from '../../lib/offline-queue';
import type { PendingSaleRecord } from '../../lib/offline-queue';
import { extractTicketPayments, printSaleTicket } from '../../lib/ticket-printer';
import type { CreateSaleRequest, ProductItem, TenantTaxMode } from '../../lib/api';
import type { TicketTemplateConfig } from '../../lib/ticket-template';
import type { CartItem, LastPrintedSaleSnapshot, PosApiClient } from '../../types';
import { CheckoutModal } from './components';
import {
  formatEditableMoneyFromCents,
  getCheckoutErrorMessage,
  inferTaxModeFromSale,
  parseRawCents,
  parseVisibleMoneyToCents,
  shouldQueueSaleAsPending
} from './utils';

type DiscountEntryMode = 'VISIBLE' | 'CENTS';

export function PosScreen({
  api,
  branchId,
  cashSessionId,
  branchName,
  branchAddress,
  isOnline = true,
  pendingSales = [],
  syncingPendingSales = false,
  syncingPendingSaleIds = [],
  ticketTemplate,
  tenantTaxMode,
  onRetryPendingSale,
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
  const [query, setQuery] = useState('');
  const [cachedProducts, setCachedProducts] = useState<ProductItem[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [selectedCartIndex, setSelectedCartIndex] = useState(-1);
  const [discountCents, setDiscountCents] = useState(0);
  const [discountEntryMode, setDiscountEntryMode] = useState<DiscountEntryMode>('VISIBLE');
  const [discountDraft, setDiscountDraft] = useState('0');
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [saleMessage, setSaleMessage] = useState<string | null>(null);
  const [lastPrintedSaleSnapshot, setLastPrintedSaleSnapshot] =
    useState<LastPrintedSaleSnapshot | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const hasSearchQuery = query.trim().length > 0;
  const selectedCartItem = cartItems[selectedCartIndex] ?? null;
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

  const subtotalCents = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.qty * item.priceCents, 0),
    [cartItems]
  );
  const cartQuantity = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.qty, 0),
    [cartItems]
  );
  const totalCents = Math.max(0, subtotalCents - discountCents);
  const canOpenCheckout = cartItems.length > 0 && totalCents > 0 && !checkoutLoading;
  const hasPendingSales = pendingSales.length > 0;

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    setProductsError(null);

    try {
      const response = await api.listProducts({
        limit: 5000,
        branchId
      });
      setCachedProducts(response.items.filter((item) => item.active));
    } catch (loadError) {
      setProductsError(
        loadError instanceof Error ? loadError.message : 'No fue posible cargar productos'
      );
    } finally {
      setProductsLoading(false);
    }
  }, [api, branchId]);

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

  useEffect(() => {
    setDiscountCents((current) => Math.min(current, subtotalCents));
  }, [subtotalCents]);

  useEffect(() => {
    setDiscountDraft(
      discountEntryMode === 'VISIBLE'
        ? formatEditableMoneyFromCents(discountCents)
        : String(discountCents)
    );
  }, [discountCents, discountEntryMode]);

  const removeSelectedItem = useCallback(() => {
    if (selectedCartIndex < 0 || selectedCartIndex >= cartItems.length) {
      return;
    }

    const nextCartItems = cartItems.filter((_, index) => index !== selectedCartIndex);
    setCartItems(nextCartItems);
    setSelectedCartIndex(
      nextCartItems.length === 0 ? -1 : Math.min(selectedCartIndex, nextCartItems.length - 1)
    );
  }, [cartItems, selectedCartIndex]);

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

  function resetCartState() {
    setCartItems([]);
    setSelectedCartIndex(-1);
    setDiscountCents(0);
  }

  function clearCart() {
    resetCartState();
    setSaleError(null);
    setSaleMessage(null);
  }

  function addProduct(product: ProductItem, options?: { clearSearch?: boolean }) {
    const existingIndex = cartItems.findIndex((item) => item.productId === product.id);

    if (existingIndex === -1) {
      setCartItems([
        ...cartItems,
        {
          productId: product.id,
          name: product.name,
          category: product.category,
          barcode: product.barcode,
          priceCents: product.price_cents,
          qty: 1
        }
      ]);
      setSelectedCartIndex(cartItems.length);
    } else {
      const nextCartItems = [...cartItems];
      const existingItem = nextCartItems[existingIndex];

      if (!existingItem) {
        return;
      }

      nextCartItems[existingIndex] = {
        ...existingItem,
        qty: existingItem.qty + 1
      };

      setCartItems(nextCartItems);
      setSelectedCartIndex(existingIndex);
    }

    setSaleError(null);
    setSaleMessage(null);

    if (options?.clearSearch && hasSearchQuery) {
      setQuery('');
      searchInputRef.current?.focus();
    }
  }

  function updateCartQty(index: number, qty: number) {
    if (qty <= 0) {
      const nextCartItems = cartItems.filter((_, itemIndex) => itemIndex !== index);
      setCartItems(nextCartItems);
      setSelectedCartIndex(nextCartItems.length === 0 ? -1 : Math.min(index, nextCartItems.length - 1));
      return;
    }

    const nextCartItems = [...cartItems];
    const target = nextCartItems[index];

    if (!target) {
      return;
    }

    nextCartItems[index] = { ...target, qty };
    setCartItems(nextCartItems);
    setSelectedCartIndex(index);
  }

  function removeCartItem(index: number) {
    const nextCartItems = cartItems.filter((_, itemIndex) => itemIndex !== index);
    setCartItems(nextCartItems);
    setSelectedCartIndex(nextCartItems.length === 0 ? -1 : Math.min(index, nextCartItems.length - 1));
  }

  function handleDiscountModeChange(mode: DiscountEntryMode) {
    setDiscountEntryMode(mode);
  }

  function handleDiscountInputChange(nextValue: string) {
    setDiscountDraft(nextValue);

    const parsedDiscount =
      discountEntryMode === 'VISIBLE'
        ? parseVisibleMoneyToCents(nextValue)
        : parseRawCents(nextValue);

    setDiscountCents(Math.min(parsedDiscount, subtotalCents));
  }

  const handleCheckout = useCallback(async (payments: CreateSaleRequest['payments']) => {
    if (!canOpenCheckout) {
      setSaleError('Verifica el carrito antes de cobrar');
      return;
    }

    setCheckoutLoading(true);
    setSaleError(null);
    setSaleMessage(null);

    const ticketItemsSnapshot = cartItems.map((item) => ({
      name: item.name,
      qty: item.qty,
      priceCents: item.priceCents,
      lineTotalCents: item.priceCents * item.qty
    }));

    const salePayload: CreateSaleRequest = {
      client_uuid: crypto.randomUUID(),
      branch_id: branchId,
      cash_session_id: cashSessionId,
      discount_cents: discountCents,
      items: cartItems.map((item) => ({
        product_id: item.productId,
        qty: item.qty,
        price_cents: item.priceCents
      })),
      payments
    };

    try {
      const result = await api.createSale(salePayload);

      resetCartState();
      setIsCheckoutModalOpen(false);
      setLastPrintedSaleSnapshot({
        sale: result.sale,
        items: ticketItemsSnapshot
      });
      setSaleMessage(
        `Venta #${result.sale.sale_number} registrada. Estado DIAN: ${
          result.sale.dian_status ?? 'PENDING'
        }`
      );
      searchInputRef.current?.focus();
      void loadProducts();
    } catch (checkoutError) {
      if (shouldQueueSaleAsPending(checkoutError)) {
        try {
          await addPendingSale(salePayload);
          await onSaleQueued();
          resetCartState();
          setIsCheckoutModalOpen(false);
          setLastPrintedSaleSnapshot(null);
          setSaleMessage(
            'Venta guardada como pendiente por falta de conexión. Sincroniza cuando vuelva internet.'
          );
          searchInputRef.current?.focus();
          return;
        } catch (queueError) {
          setSaleError(getCheckoutErrorMessage(queueError));
          return;
        }
      }

      setSaleError(getCheckoutErrorMessage(checkoutError));
    } finally {
      setCheckoutLoading(false);
    }
  }, [
    api,
    branchId,
    canOpenCheckout,
    cartItems,
    cashSessionId,
    discountCents,
    loadProducts,
    onSaleQueued
  ]);

  function handlePrintLastSale() {
    if (!lastPrintedSaleSnapshot) {
      return;
    }

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

  function getPendingSaleStatus(record: PendingSaleRecord) {
    if (syncingPendingSaleIds.includes(record.id)) {
      return {
        label: 'Sincronizando',
        tagClassName: 'tag-info'
      };
    }

    if (record.sync_state === 'FAILED') {
      return {
        label: 'Con error',
        tagClassName: 'tag-danger'
      };
    }

    return {
      label: 'Pendiente',
      tagClassName: 'tag-warning'
    };
  }

  function getPendingSaleTotalCents(record: PendingSaleRecord) {
    const subtotal = record.payload.items.reduce(
      (sum, item) => sum + Math.round(item.qty * (item.price_cents ?? 0)),
      0
    );

    return Math.max(0, subtotal - record.payload.discount_cents);
  }

  function formatPendingSaleDate(value: string) {
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isCheckoutModalOpen) {
        return;
      }

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

      if (event.key === 'Enter') {
        if (isSearchInput && highlightedProduct) {
          event.preventDefault();
          addProduct(highlightedProduct, { clearSearch: true });
          return;
        }

        if (isTypingTarget) {
          return;
        }

        event.preventDefault();
        if (canOpenCheckout) {
          setSaleError(null);
          setIsCheckoutModalOpen(true);
        }
        return;
      }

      if (event.key === 'Delete') {
        if (isTypingTarget) {
          return;
        }

        event.preventDefault();
        removeSelectedItem();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canOpenCheckout, highlightedProduct, isCheckoutModalOpen, moveHighlightedProduct, removeSelectedItem]);

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
                ref={searchInputRef}
                placeholder="Escanea o busca un producto... (Ctrl+K)"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    moveHighlightedProduct('next');
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    moveHighlightedProduct('previous');
                  } else if (event.key === 'Enter' && highlightedProduct) {
                    event.preventDefault();
                    addProduct(highlightedProduct, { clearSearch: true });
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
                  type="button"
                  className="quick-product-button"
                  style={{ background: 'var(--color-primary-600)', padding: '0.75rem 2rem' }}
                  onClick={() => {
                    if (highlightedProduct) {
                      addProduct(highlightedProduct, { clearSearch: true });
                    }
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

        <div className="product-grid-header">
          <div>
            <strong style={{ fontSize: '1.125rem' }}>Catálogo de Productos</strong>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-slate-500)' }}>
              {hasSearchQuery
                ? `Mostrando ${products.length} coincidencias`
                : 'Selecciona un item para añadirlo al carrito'}
            </p>
          </div>
        </div>

        <div className="product-grid">
          {products.length === 0 && !productsLoading ? (
            <div className="empty-state" style={{ gridColumn: '1 / -1', padding: '4rem', textAlign: 'center' }}>
              No hay productos disponibles para mostrar.
            </div>
          ) : (
            products.map((product) => (
              <button
                key={product.id}
                className={`product-card ${highlightedProduct?.id === product.id ? 'is-highlighted' : ''}`}
                onMouseEnter={() => setHighlightedProductId(product.id)}
                onTouchStart={() => setHighlightedProductId(product.id)}
                onClick={() => addProduct(product, { clearSearch: true })}
                type="button"
              >
                <div style={{ height: '95px', width: '100%', overflow: 'hidden', borderBottom: '1px solid var(--color-slate-100)', flexShrink: 0 }}>
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <PlaceholderImage name={product.name} category={product.category} size="md" />
                  )}
                </div>
                <div style={{ padding: '0.625rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <span className="product-name">{product.name}</span>
                  <span className="product-meta">{product.category}</span>
                </div>
                <div style={{ borderTop: '1px solid var(--color-slate-100)', padding: '0.4rem 0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.6rem', color: 'var(--color-slate-400)', fontWeight: 500 }}>{product.barcode || 'S/C'}</span>
                  <span className="product-price">{formatMoneyFromCents(product.price_cents)}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <aside className="cart-panel">
        <header className="section-heading">
          <div className="heading-copy">
            <h3>Orden Actual</h3>
            <p>{cartQuantity} {cartQuantity === 1 ? 'producto' : 'productos'}</p>
          </div>
          {cartItems.length > 0 && (
            <button className="ghost-button" style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem' }} onClick={clearCart}>
              Vaciar
            </button>
          )}
        </header>

        <div className="cart-list">
          {cartItems.length === 0 ? (
            <div className="empty-state" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '2rem', color: 'var(--color-slate-400)' }}>
              <div>
                <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🛒</div>
                <p>El carrito está vacío</p>
              </div>
            </div>
          ) : (
            cartItems.map((item, index) => (
              <article
                key={item.productId}
                className={`cart-row ${index === selectedCartIndex ? 'selected' : ''}`}
                onClick={() => setSelectedCartIndex(index)}
                role="button"
                tabIndex={0}
              >
                <div className="cart-row-main">
                  <div className="cart-row-name">
                    <strong>{item.name}</strong>
                    <div className="cart-row-submeta">
                      <span>{formatMoneyFromCents(item.priceCents)} c/u</span>
                      {item.barcode && <span className="tag-muted">{item.barcode}</span>}
                    </div>
                  </div>
                  <strong style={{ color: 'var(--color-slate-900)' }}>{formatMoneyFromCents(item.priceCents * item.qty)}</strong>
                </div>

                <div className="cart-row-controls">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'var(--color-slate-200)', borderRadius: 'var(--radius-md)', padding: '0.25rem' }}>
                    <button
                      type="button"
                      className="mini-btn"
                      style={{ border: 'none', background: 'transparent', boxShadow: 'none' }}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateCartQty(index, item.qty - 1);
                      }}
                    >
                      -
                    </button>
                    <input
                      aria-label="Cantidad"
                      className="cart-row-qty"
                      style={{ border: 'none', background: '#ffffff', height: '1.75rem', fontSize: '0.875rem' }}
                      value={item.qty}
                      type="number"
                      min={1}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => updateCartQty(index, Number(event.target.value))}
                    />
                    <button
                      type="button"
                      className="mini-btn"
                      style={{ border: 'none', background: 'transparent', boxShadow: 'none' }}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateCartQty(index, item.qty + 1);
                      }}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="ghost-button"
                    style={{ border: 'none', color: 'var(--color-error-600)', background: 'transparent', boxShadow: 'none', padding: '0.25rem' }}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeCartItem(index);
                    }}
                  >
                    🗑️
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        <div className="cart-summary-panel">
          <div className="discount-card" style={{ padding: '0.75rem' }}>
            <div className="discount-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)' }}>DESCUENTO</span>
              <div className="discount-mode-toggle" style={{ margin: 0, padding: '0.1rem' }}>
                <button
                  type="button"
                  className={`discount-mode-btn ${discountEntryMode === 'VISIBLE' ? 'active' : ''}`}
                  onClick={() => handleDiscountModeChange('VISIBLE')}
                  style={{ padding: '0.1rem 0.4rem', fontSize: '0.7rem' }}
                >
                  $
                </button>
                <button
                  type="button"
                  className={`discount-mode-btn ${discountEntryMode === 'CENTS' ? 'active' : ''}`}
                  onClick={() => handleDiscountModeChange('CENTS')}
                  style={{ padding: '0.1rem 0.4rem', fontSize: '0.7rem' }}
                >
                  ¢
                </button>
              </div>
            </div>

            <input
              inputMode={discountEntryMode === 'VISIBLE' ? 'decimal' : 'numeric'}
              placeholder="0.00"
              style={{ padding: '0.4rem', fontSize: '0.875rem', height: '2rem' }}
              type="number"
              value={discountDraft}
              onChange={(event) => handleDiscountInputChange(event.target.value)}
            />
          </div>

          <div className="totals-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'rgba(255,255,255,0.7)' }}>
              <span>Subtotal</span>
              <span>{formatMoneyFromCents(subtotalCents)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'rgba(255,255,255,0.7)' }}>
              <span>Descuento</span>
              <span>-{formatMoneyFromCents(discountCents)}</span>
            </div>
            <div className="summary-highlight" style={{ marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Total</span>
                <strong style={{ fontSize: '1.75rem' }}>{formatMoneyFromCents(totalCents)}</strong>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="charge-button"
            disabled={!canOpenCheckout}
            onClick={() => {
              setSaleError(null);
              setIsCheckoutModalOpen(true);
            }}
          >
            {checkoutLoading ? 'Procesando...' : '💳 Cobrar'}
          </button>
        </div>

        {saleError && <div style={{ marginTop: '1rem' }}><Banner tone="error">{saleError}</Banner></div>}
        {saleMessage && <div style={{ marginTop: '1rem' }}><Banner tone="success">{saleMessage}</Banner></div>}

        {lastPrintedSaleSnapshot && cartItems.length === 0 && (
          <div className="sale-result-card" style={{ marginTop: '1rem', padding: '1rem', background: 'var(--color-primary-50)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-primary-100)' }}>
             <div style={{ marginBottom: '0.75rem' }}>
                <span className="tag tag-info" style={{ fontSize: '0.65rem' }}>ÚLTIMA VENTA</span>
                <h4 style={{ margin: '0.25rem 0' }}>#{lastPrintedSaleSnapshot?.sale.sale_number}</h4>
             </div>
             <button className="ghost-button" style={{ width: '100%', padding: '0.5rem' }} onClick={handlePrintLastSale}>
               🖨️ Re-imprimir Ticket
             </button>
          </div>
        )}

        {hasPendingSales && (
            <div className="pending-sales-card" style={{ marginTop: '1rem', padding: '1rem', background: 'var(--color-warning-50)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-warning-100)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-warning-700)' }}>
                        {pendingSales.length} {pendingSales.length === 1 ? 'pendiente' : 'pendientes'}
                    </span>
                    <button 
                        className="ghost-button" 
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }}
                        onClick={() => void onSyncPendingSales?.()}
                        disabled={syncingPendingSales}
                    >
                        {syncingPendingSales ? '...' : 'Sincronizar'}
                    </button>
                </div>
            </div>
        )}
      </aside>

      <CheckoutModal
        cartItems={cartItems}
        discountCents={discountCents}
        error={saleError}
        isOpen={isCheckoutModalOpen}
        isSubmitting={checkoutLoading}
        onClose={() => {
          if (!checkoutLoading) {
            setIsCheckoutModalOpen(false);
          }
        }}
        onConfirm={handleCheckout}
        totalCents={totalCents}
      />
    </div>
  );
}
