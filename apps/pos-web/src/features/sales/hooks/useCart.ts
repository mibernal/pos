import { useCallback, useMemo, useState } from 'react';
import type { CartItem } from '../../../types';
import type { ProductItem } from '../../../lib/api';

export function useCart() {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [selectedCartIndex, setSelectedCartIndex] = useState(-1);
  const [parkedCarts, setParkedCarts] = useState<CartItem[][]>([]);

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

  const addProduct = useCallback((product: ProductItem, variant?: { id: string, name: string, price_cents: number }) => {
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
            qty: 1
          }
        ];
      }

      const existingItem = currentCartItems[existingIndex];
      if (!existingItem) return currentCartItems;

      const nextCartItems = [...currentCartItems];
      nextCartItems[existingIndex] = {
        ...existingItem,
        qty: existingItem.qty + 1
      };
      setSelectedCartIndex(existingIndex);
      return nextCartItems;
    });
  }, []);

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
  }, []);

  const resetCartState = useCallback(() => {
    setCartItems([]);
    setSelectedCartIndex(-1);
  }, []);

  const parkCart = useCallback(() => {
    if (cartItems.length === 0) return;
    setParkedCarts((current) => [...current, cartItems]);
    resetCartState();
  }, [cartItems, resetCartState]);

  const restoreCart = useCallback((index: number) => {
    setParkedCarts((current) => {
      const cartToRestore = current[index];
      if (!cartToRestore) return current;
      
      setCartItems(cartToRestore);
      setSelectedCartIndex(-1);
      
      return current.filter((_, i) => i !== index);
    });
  }, []);

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
    resetCartState,
    parkCart,
    restoreCart
  };
}
