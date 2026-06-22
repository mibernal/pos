import { useCallback, useMemo } from 'react';
import { useCartStore } from './useCartStore';
import { useTablesStore } from '../../tables/store/useTablesStore';
import type { CartItem } from '../../../types';
import type { ProductItem } from '../../../lib/api';

export function useCart() {
  const activeTable = useTablesStore((state) => state.activeTable);
  const isTableMode = !!activeTable;
  const tableId = activeTable?.id;

  const globalCartItems = useCartStore((state) => state.cartItems);
  const globalSelectedIndex = useCartStore((state) => state.selectedCartIndex);
  
  const tableCarts = useCartStore((state) => state.tableCarts);
  const tableCartIndices = useCartStore((state) => state.tableCartIndices);

  const parkedCarts = useCartStore((state) => state.parkedCarts);
  
  const setGlobalCartItems = useCartStore((state) => state.setCartItems);
  const setTableCartItems = useCartStore((state) => state.setTableCartItems);
  
  const setGlobalSelectedIndex = useCartStore((state) => state.setSelectedCartIndex);
  const setTableCartIndex = useCartStore((state) => state.setTableCartIndex);
  
  const setParkedCarts = useCartStore((state) => state.setParkedCarts);
  
  const resetGlobalCart = useCartStore((state) => state.resetCart);
  const resetTableCart = useCartStore((state) => state.resetTableCart);

  const cartItems = isTableMode ? (tableCarts[tableId!] || []) : globalCartItems;
  const selectedCartIndex = isTableMode ? (tableCartIndices[tableId!] ?? -1) : globalSelectedIndex;

  const setCartItems = useCallback((items: CartItem[] | ((curr: CartItem[]) => CartItem[])) => {
    if (isTableMode) {
      setTableCartItems(tableId!, items);
    } else {
      setGlobalCartItems(items);
    }
  }, [isTableMode, tableId, setTableCartItems, setGlobalCartItems]);

  const setSelectedCartIndex = useCallback((index: number | ((curr: number) => number)) => {
    if (isTableMode) {
      setTableCartIndex(tableId!, index);
    } else {
      setGlobalSelectedIndex(index);
    }
  }, [isTableMode, tableId, setTableCartIndex, setGlobalSelectedIndex]);

  const resetCartState = useCallback(() => {
    if (isTableMode) {
      resetTableCart(tableId!);
    } else {
      resetGlobalCart();
    }
  }, [isTableMode, tableId, resetTableCart, resetGlobalCart]);

  const subtotalCents = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.qty * item.priceCents, 0),
    [cartItems]
  );
  
  const discountCents = useMemo(() => {
    return cartItems.reduce((sum, item) => {
      let lineDiscount = 0;
      if (item.promotion) {
        const lineTotalCents = item.qty * item.priceCents;
        if (item.promotion.type === 'PERCENTAGE') {
          lineDiscount = Math.round((lineTotalCents * item.promotion.value_cents) / 10000);
        } else if (item.promotion.type === 'FIXED_AMOUNT') {
          lineDiscount = item.promotion.value_cents * item.qty;
        } else if (item.promotion.type === 'BUY_X_GET_Y' && item.promotion.buy_qty && item.promotion.get_qty) {
          const timesApplied = Math.floor(item.qty / item.promotion.buy_qty);
          const freeItems = timesApplied * item.promotion.get_qty;
          const validFreeItems = Math.min(freeItems, item.qty);
          lineDiscount = validFreeItems * item.priceCents;
        }
      }
      return sum + lineDiscount;
    }, 0);
  }, [cartItems]);
  
  const cartQuantity = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.qty, 0),
    [cartItems]
  );

  const totalCents = Math.max(0, subtotalCents - discountCents);

  const addProduct = useCallback((product: ProductItem, variant?: { id: string, name: string, price_cents: number }, qty: number = 1) => {
    setCartItems((currentCartItems) => {
      const existingIndex = currentCartItems.findIndex(
        (item) => item.productId === product.id && item.variantId === (variant?.id || null)
      );

      if (existingIndex === -1) {
        setSelectedCartIndex(currentCartItems.length);
        return [
          ...currentCartItems,
          {
            productId: product.id,
            variantId: variant?.id || null,
            name: product.name,
            variantName: variant?.name || null,
            category: product.category,
            barcode: product.barcode,
            priceCents: variant?.price_cents ?? product.price_cents,
            promotion: product.promotion as CartItem['promotion'],
            imageUrl: product.imageUrl,
            qty
          }
        ];
      }

      const existingItem = currentCartItems[existingIndex];
      if (!existingItem) return currentCartItems;

      const nextCartItems = [...currentCartItems];
      nextCartItems[existingIndex] = {
        ...existingItem,
        qty: existingItem.qty + qty
      };
      setSelectedCartIndex(existingIndex);
      return nextCartItems;
    });
  }, [setCartItems, setSelectedCartIndex]);

  const removeSelectedItem = useCallback(() => {
    if (selectedCartIndex < 0 || selectedCartIndex >= cartItems.length) {
      return;
    }

    const nextCartItems = cartItems.filter((_, index) => index !== selectedCartIndex);
    setCartItems(nextCartItems);
    setSelectedCartIndex(
      nextCartItems.length === 0 ? -1 : Math.min(selectedCartIndex, nextCartItems.length - 1)
    );
  }, [cartItems, selectedCartIndex, setCartItems, setSelectedCartIndex]);

  const updateCartQty = useCallback((index: number, qty: number) => {
    if (qty <= 0) {
      setCartItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
      return;
    }

    setCartItems((current) => {
      const next = [...current];
      const item = next[index];
      if (item) {
        next[index] = { ...item, qty };
      }
      return next;
    });
  }, [setCartItems]);

  const updateCartNotes = useCallback((index: number, notes: string) => {
    setCartItems((current) => {
      const next = [...current];
      const item = next[index];
      if (item) {
        next[index] = { ...item, notes };
      }
      return next;
    });
  }, [setCartItems]);

  const parkCart = useCallback(() => {
    if (cartItems.length === 0) return;
    setParkedCarts((current) => [...current, cartItems]);
    resetCartState();
  }, [cartItems, resetCartState, setParkedCarts]);

  const restoreCart = useCallback((index: number) => {
    setParkedCarts((current) => {
      const cartToRestore = current[index];
      if (!cartToRestore) return current;
      
      setCartItems(cartToRestore);
      setSelectedCartIndex(-1);
      
      return current.filter((_, i) => i !== index);
    });
  }, [setCartItems, setSelectedCartIndex, setParkedCarts]);

  return {
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
    updateCartNotes,
    resetCartState,
    parkCart,
    restoreCart,
    setCartItems
  };
}
