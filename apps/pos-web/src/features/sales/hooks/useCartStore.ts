import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem } from '../../../types';

interface CartState {
  cartItems: CartItem[];
  selectedCartIndex: number;
  parkedCarts: CartItem[][];
  setCartItems: (items: CartItem[] | ((curr: CartItem[]) => CartItem[])) => void;
  setSelectedCartIndex: (index: number | ((curr: number) => number)) => void;
  setParkedCarts: (carts: CartItem[][] | ((curr: CartItem[][]) => CartItem[][])) => void;
  resetCart: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      cartItems: [],
      selectedCartIndex: -1,
      parkedCarts: [],
      
      setCartItems: (items) => 
        set((state) => ({ 
          cartItems: typeof items === 'function' ? items(state.cartItems) : items 
        })),
        
      setSelectedCartIndex: (index) => 
        set((state) => ({ 
          selectedCartIndex: typeof index === 'function' ? index(state.selectedCartIndex) : index 
        })),
        
      setParkedCarts: (carts) => 
        set((state) => ({ 
          parkedCarts: typeof carts === 'function' ? carts(state.parkedCarts) : carts 
        })),
        
      resetCart: () => 
        set({ cartItems: [], selectedCartIndex: -1 })
    }),
    {
      name: 'pos-draft-sale-v1',
    }
  )
);
