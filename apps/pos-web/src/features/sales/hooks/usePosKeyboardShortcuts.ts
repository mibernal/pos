import { useEffect } from 'react';
import type { ProductItem } from '../../../lib/api';

interface PosKeyboardShortcutsProps {
  isCheckoutModalOpen: boolean;
  searchInputRef: React.RefObject<HTMLInputElement>;
  moveHighlightedProduct: (dir: 'next' | 'previous') => void;
  canOpenCheckout: boolean;
  checkoutLoading: boolean;
  setSaleError: (error: string | null) => void;
  setIsCheckoutModalOpen: (open: boolean) => void;
  cartItemsCount: number;
  parkCart: () => void;
  setSaleMessage: (msg: string | null) => void;
  parkedCartsCount: number;
  restoreCart: (index: number) => void;
  hasLastPrintedSaleSnapshot: boolean;
  handlePrintLastSale: () => void;
  query: string;
  cachedProducts: ProductItem[];
  handleProductSelect: (product: ProductItem, qty?: number) => void;
  highlightedProduct: ProductItem | null;
  removeSelectedItem: () => void;
}

export function usePosKeyboardShortcuts({
  isCheckoutModalOpen,
  searchInputRef,
  moveHighlightedProduct,
  canOpenCheckout,
  checkoutLoading,
  setSaleError,
  setIsCheckoutModalOpen,
  cartItemsCount,
  parkCart,
  setSaleMessage,
  parkedCartsCount,
  restoreCart,
  hasLastPrintedSaleSnapshot,
  handlePrintLastSale,
  query,
  cachedProducts,
  handleProductSelect,
  highlightedProduct,
  removeSelectedItem
}: PosKeyboardShortcutsProps) {
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
        if (cartItemsCount > 0) {
          parkCart();
          setSaleMessage('Venta pausada. Se ha puesto en espera.');
        }
        return;
      }

      if (event.key === 'F10') {
        event.preventDefault();
        if (parkedCartsCount > 0) {
          restoreCart(0);
          setSaleMessage('Venta recuperada de la espera.');
        }
        return;
      }

      if (event.key === 'F12') {
        event.preventDefault();
        if (hasLastPrintedSaleSnapshot) {
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
    isCheckoutModalOpen,
    searchInputRef,
    moveHighlightedProduct,
    canOpenCheckout,
    checkoutLoading,
    setSaleError,
    setIsCheckoutModalOpen,
    cartItemsCount,
    parkCart,
    setSaleMessage,
    parkedCartsCount,
    restoreCart,
    hasLastPrintedSaleSnapshot,
    handlePrintLastSale,
    query,
    cachedProducts,
    handleProductSelect,
    highlightedProduct,
    removeSelectedItem
  ]);
}
