import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem } from '../../../types';

interface CartState {
  cartItems: CartItem[];
  selectedCartIndex: number;
  parkedCarts: CartItem[][];
  
  tableCarts: Record<string, CartItem[]>;
  tableCartIndices: Record<string, number>;

  setCartItems: (items: CartItem[] | ((curr: CartItem[]) => CartItem[])) => void;
  setSelectedCartIndex: (index: number | ((curr: number) => number)) => void;
  setParkedCarts: (carts: CartItem[][] | ((curr: CartItem[][]) => CartItem[][])) => void;
  
  setTableCartItems: (tableId: string, items: CartItem[] | ((curr: CartItem[]) => CartItem[])) => void;
  setTableCartIndex: (tableId: string, index: number | ((curr: number) => number)) => void;
  resetTableCart: (tableId: string) => void;

  resetCart: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      cartItems: [],
      selectedCartIndex: -1,
      parkedCarts: [],
      tableCarts: {},
      tableCartIndices: {},
      
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
        
      setTableCartItems: (tableId, items) =>
        set((state) => {
          const currentTableCart = state.tableCarts[tableId] || [];
          const nextItems = typeof items === 'function' ? items(currentTableCart) : items;
          return {
            tableCarts: { ...state.tableCarts, [tableId]: nextItems }
          };
        }),
        
      setTableCartIndex: (tableId, index) =>
        set((state) => {
          const currentIndex = state.tableCartIndices[tableId] ?? -1;
          const nextIndex = typeof index === 'function' ? index(currentIndex) : index;
          return {
            tableCartIndices: { ...state.tableCartIndices, [tableId]: nextIndex }
          };
        }),
        
      resetTableCart: (tableId) =>
        set((state) => {
          const nextTableCarts = { ...state.tableCarts };
          delete nextTableCarts[tableId];
          const nextIndices = { ...state.tableCartIndices };
          delete nextIndices[tableId];
          return { tableCarts: nextTableCarts, tableCartIndices: nextIndices };
        }),

      resetCart: () => 
        set({ cartItems: [], selectedCartIndex: -1 })
    }),
    {
      name: 'pos-draft-sale-v1',
    }
  )
);
