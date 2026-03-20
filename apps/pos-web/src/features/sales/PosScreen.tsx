import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner } from '../../components/ui';
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
        <div className="section-heading pos-heading">
          <div>
            <h2>Caja principal</h2>
            <p>Flujo rápido para cajero, búsqueda instantánea y catálogo táctil</p>
          </div>
          <div className="pos-metrics">
            <div className="metric-card">
              <span>Productos</span>
              <strong>{products.length}</strong>
            </div>
            <div className="metric-card">
              <span>Unidades</span>
              <strong>{cartQuantity}</strong>
            </div>
            <div className="metric-card">
              <span>Total</span>
              <strong>{formatMoneyFromCents(totalCents)}</strong>
            </div>
          </div>
        </div>

        <div className="pos-search-panel">
          <div className="pos-search-toolbar">
            <label className="field pos-search-field">
              <span>Búsqueda rápida</span>
              <input
                ref={searchInputRef}
                placeholder="Nombre o código de barras"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    event.stopPropagation();
                    moveHighlightedProduct('next');
                    return;
                  }

                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    event.stopPropagation();
                    moveHighlightedProduct('previous');
                    return;
                  }

                  if (event.key === 'Enter' && highlightedProduct) {
                    event.preventDefault();
                    event.stopPropagation();
                    addProduct(highlightedProduct, { clearSearch: true });
                  }
                }}
              />
            </label>
            {hasSearchQuery ? (
              <button
                className="ghost-button pos-search-clear"
                type="button"
                onClick={() => {
                  setQuery('');
                  searchInputRef.current?.focus();
                }}
              >
                Limpiar búsqueda
              </button>
            ) : null}
          </div>

          <div className="pos-keyboard-hint">
            <span className="hint-chip">
              <kbd>Ctrl</kbd>+<kbd>K</kbd> buscar
            </span>
            <span className="hint-chip">
              <kbd>Enter</kbd> agrega destacado
            </span>
            <span className="hint-chip">
              <kbd>Del</kbd> elimina item seleccionado
            </span>
          </div>
        </div>

        {productsLoading ? <Banner tone="info">Actualizando catálogo...</Banner> : null}
        {productsError ? <Banner tone="error">{productsError}</Banner> : null}

        <div className="quick-product-card">
          {highlightedProduct ? (
            <div className="quick-product-main">
              <div className="quick-product-copy">
                <span className="quick-product-badge">Resultado rápido</span>
                <h3>{highlightedProduct.name}</h3>
                <div className="quick-product-meta">
                  <span>{highlightedProduct.category}</span>
                  {highlightedProduct.barcode ? <span>Cod. {highlightedProduct.barcode}</span> : null}
                  <span>{hasSearchQuery ? 'Coincide con tu búsqueda' : 'Disponible para venta'}</span>
                </div>
              </div>
              <div className="quick-product-actions">
                <strong>{formatMoneyFromCents(highlightedProduct.price_cents)}</strong>
                <button
                  type="button"
                  className="quick-product-button"
                  onClick={() => addProduct(highlightedProduct, { clearSearch: true })}
                >
                  Agregar destacado
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              {hasSearchQuery
                ? 'No hay productos que coincidan con esa búsqueda.'
                : 'No hay productos activos disponibles en esta sucursal.'}
            </div>
          )}
        </div>

        <div className="product-grid-header">
          <div>
            <strong>{hasSearchQuery ? 'Resultados filtrados' : 'Catálogo táctil'}</strong>
            <span>
              {hasSearchQuery
                ? `${products.length} coincidencia(s) por nombre o código de barras`
                : 'Toca una tarjeta para agregar al carrito'}
            </span>
          </div>
        </div>

        <div className="product-grid">
          {products.length === 0 && !productsLoading ? (
            <div className="empty-state">Aún no hay productos para vender en esta caja.</div>
          ) : (
            products.map((product) => (
              <button
                key={product.id}
                className={`product-card ${
                  highlightedProduct?.id === product.id ? 'is-highlighted' : ''
                }`}
                onMouseEnter={() => setHighlightedProductId(product.id)}
                onFocus={() => setHighlightedProductId(product.id)}
                onClick={() => addProduct(product, { clearSearch: true })}
                type="button"
              >
                <span className="product-name">{product.name}</span>
                <span className="product-meta">{product.category}</span>
                <span className="product-card-footer">
                  <span className="product-barcode">{product.barcode ?? 'Sin código'}</span>
                  <span className="product-price">{formatMoneyFromCents(product.price_cents)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      <aside className="cart-panel">
        <div className="section-heading">
          <div>
            <h3>Carrito actual</h3>
            <p>
              {cartQuantity} unidades en {cartItems.length} línea(s)
            </p>
          </div>
          {cartItems.length > 0 ? (
            <div className="cart-header-actions">
              <button className="ghost-button" type="button" onClick={clearCart}>
                Limpiar carrito
              </button>
            </div>
          ) : null}
        </div>

        {selectedCartItem ? (
          <div className="cart-selection-note">
            Seleccionado: <strong>{selectedCartItem.name}</strong>. Usa <kbd>Del</kbd> para quitarlo
            rápido.
          </div>
        ) : null}

        <div className="cart-list">
          {cartItems.length === 0 ? (
            <div className="empty-state">
              Agrega productos desde la búsqueda o el catálogo para iniciar la venta.
            </div>
          ) : (
            cartItems.map((item, index) => (
              <article
                key={item.productId}
                className={`cart-row ${index === selectedCartIndex ? 'selected' : ''}`}
                onClick={() => setSelectedCartIndex(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedCartIndex(index);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="cart-row-main">
                  <div className="cart-row-name">
                    <strong>{item.name}</strong>
                    <div className="cart-row-submeta">
                      <span>{item.category}</span>
                      {item.barcode ? <span>{item.barcode}</span> : null}
                      <span>{formatMoneyFromCents(item.priceCents)} c/u</span>
                    </div>
                  </div>
                  <strong>{formatMoneyFromCents(item.priceCents * item.qty)}</strong>
                </div>

                <div className="cart-row-controls">
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      updateCartQty(index, item.qty - 1);
                    }}
                  >
                    -
                  </button>
                  <input
                    aria-label={`Cantidad de ${item.name}`}
                    className="cart-row-qty"
                    value={item.qty}
                    type="number"
                    min={1}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updateCartQty(index, Number(event.target.value))}
                  />
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      updateCartQty(index, item.qty + 1);
                    }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="cart-row-remove"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeCartItem(index);
                    }}
                  >
                    Quitar
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        <div className="cart-summary-panel">
          <div className="discount-card">
            <div className="section-heading">
              <div>
                <h3>Descuento total</h3>
                <p>Aplica descuento visible o técnico sin salir del flujo de caja</p>
              </div>
            </div>

            <div className="discount-mode-toggle" role="tablist" aria-label="Modo de descuento">
              <button
                type="button"
                className={`discount-mode-btn ${
                  discountEntryMode === 'VISIBLE' ? 'active' : ''
                }`}
                onClick={() => handleDiscountModeChange('VISIBLE')}
              >
                Visible
              </button>
              <button
                type="button"
                className={`discount-mode-btn ${
                  discountEntryMode === 'CENTS' ? 'active' : ''
                }`}
                onClick={() => handleDiscountModeChange('CENTS')}
              >
                Cents
              </button>
            </div>

            <label className="field">
              <span>
                {discountEntryMode === 'VISIBLE'
                  ? 'Descuento visible (COP)'
                  : 'Descuento técnico (cents)'}
              </span>
              <input
                inputMode={discountEntryMode === 'VISIBLE' ? 'decimal' : 'numeric'}
                min={0}
                step={discountEntryMode === 'VISIBLE' ? '0.01' : '1'}
                type="number"
                value={discountDraft}
                onChange={(event) => handleDiscountInputChange(event.target.value)}
              />
            </label>

            <p className="discount-helper">
              Aplicado: <strong>{formatMoneyFromCents(discountCents)}</strong> · {discountCents} cents
            </p>
          </div>

          <div className="totals-box totals-box-strong">
            <div>
              <span>Subtotal</span>
              <strong>{formatMoneyFromCents(subtotalCents)}</strong>
            </div>
            <div>
              <span>Descuento</span>
              <strong>-{formatMoneyFromCents(discountCents)}</strong>
            </div>
            <div className="summary-highlight">
              <span>Total a cobrar</span>
              <strong>{formatMoneyFromCents(totalCents)}</strong>
            </div>
          </div>

          {saleMessage ? <Banner tone="success">{saleMessage}</Banner> : null}

          {lastPrintedSaleSnapshot && cartItems.length === 0 ? (
            <div className="sale-result-card">
              <div>
                <span className="quick-product-badge">Venta confirmada</span>
                <h3>Venta #{lastPrintedSaleSnapshot.sale.sale_number}</h3>
                <p>
                  Estado DIAN inicial:{' '}
                  <strong>{lastPrintedSaleSnapshot.sale.dian_status ?? 'PENDING'}</strong>
                </p>
              </div>

              <div className="sale-result-actions">
                <button className="ghost-button" type="button" onClick={handlePrintLastSale}>
                  Imprimir ticket
                </button>
              </div>
            </div>
          ) : null}

          <div className="pending-sales-card">
            <div className="section-heading">
              <div>
                <h3>Ventas pendientes</h3>
                <p>
                  {isOnline
                    ? 'Listas para sincronizar con el backend.'
                    : 'Sin conexión. Las ventas nuevas se guardarán localmente.'}
                </p>
              </div>

              <div className="pending-sales-card-actions">
                <span className={`tag ${hasPendingSales ? 'tag-warning' : 'tag-success'}`}>
                  Pendientes {pendingSales.length}
                </span>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void onSyncPendingSales?.()}
                  disabled={!hasPendingSales || syncingPendingSales}
                >
                  {syncingPendingSales ? 'Sincronizando...' : 'Sincronizar'}
                </button>
              </div>
            </div>

            {!isOnline ? (
              <Banner tone="warning">
                El equipo está sin internet. El POS seguirá guardando ventas para sincronizarlas luego.
              </Banner>
            ) : null}

            {hasPendingSales ? (
              <div className="pending-sales-list">
                {pendingSales.map((pendingSale) => {
                  const status = getPendingSaleStatus(pendingSale);
                  return (
                    <article key={pendingSale.id} className="pending-sale-row">
                      <div className="pending-sale-row-head">
                        <div>
                          <strong>{formatMoneyFromCents(getPendingSaleTotalCents(pendingSale))}</strong>
                          <p>
                            Cola local {pendingSale.id.slice(0, 8)} · {formatPendingSaleDate(pendingSale.queued_at)}
                          </p>
                        </div>
                        <span className={`tag ${status.tagClassName}`}>{status.label}</span>
                      </div>

                      <div className="pending-sale-row-meta">
                        <span>{pendingSale.payload.items.length} item(s)</span>
                        <span>{pendingSale.payload.payments.length} pago(s)</span>
                        <span>Intentos {pendingSale.sync_attempts}</span>
                      </div>

                      {pendingSale.last_error ? (
                        <div className="pending-sale-error">{pendingSale.last_error}</div>
                      ) : null}

                      <div className="pending-sale-actions">
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={syncingPendingSales || syncingPendingSaleIds.includes(pendingSale.id)}
                          onClick={() => void onRetryPendingSale?.(pendingSale.id)}
                        >
                          {syncingPendingSaleIds.includes(pendingSale.id) ? 'Reintentando...' : 'Reintentar'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                No hay ventas pendientes. Las ventas offline aparecerán aquí hasta sincronizarse.
              </div>
            )}
          </div>

          <div className="checkout-launch-card">
            <div>
              <h3>Cobro</h3>
              <p>Define el método al momento de cobrar y valida el pago en una sola vista.</p>
            </div>

            <button
              className="charge-button"
              disabled={!canOpenCheckout}
              onClick={() => {
                setSaleError(null);
                setIsCheckoutModalOpen(true);
              }}
            >
              <span>Cobrar ahora</span>
              <strong>{checkoutLoading ? 'Procesando...' : formatMoneyFromCents(totalCents)}</strong>
            </button>
          </div>
        </div>
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
