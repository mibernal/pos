import { useEffect, useState } from 'react';
import type { ProductItem } from '@pos-dian/shared';
import type { CartItem } from '../../../types';

interface TableOrderItem {
  productId: string;
  variantId?: string | null;
  priceCents: number;
  qty: number;
  notes?: string | null;
  course?: number;
}

interface TableOrderData {
  order: { waiterId?: string | null; guestsCount?: number | null };
  items: TableOrderItem[];
}

interface Mesa {
  id: string;
  currentOrderId?: string | null;
}

interface Opciones {
  activeTable: Mesa | null | undefined;
  tableOrderData: TableOrderData | null | undefined;
  cachedProducts: ProductItem[];
  cartItems: CartItem[];
  setCartItems: (items: CartItem[]) => void;
  onWaiterLoaded: (waiterId: string | null) => void;
  onGuestsLoaded: (guests: number) => void;
}

/**
 * Trae la cuenta de una mesa al carrito, y solo una vez.
 *
 * `tableSyncedId` es lo que impide que se vuelva a cargar en cada render: sin él, cada vez
 * que llega la respuesta de la mesa el carrito se sobrescribiría, y lo que el cajero acabara
 * de añadir desaparecería delante de él.
 */
export function useTableOrderSync({
  activeTable,
  tableOrderData,
  cachedProducts,
  cartItems,
  setCartItems,
  onWaiterLoaded,
  onGuestsLoaded
}: Opciones) {
  const [tableSyncedId, setTableSyncedId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeTable) {
      if (tableSyncedId !== null) setTableSyncedId(null);
      return;
    }

    if (!activeTable.currentOrderId || !tableOrderData) return;
    if (tableSyncedId === activeTable.id) return;

    setCartItems(tableOrderData.items.map((item) => conDatosDelCatalogo(item, cachedProducts)));
    onWaiterLoaded(tableOrderData.order.waiterId || null);
    onGuestsLoaded(tableOrderData.order.guestsCount || 1);
    setTableSyncedId(activeTable.id);
  }, [activeTable, tableOrderData, tableSyncedId, setCartItems, cachedProducts, onWaiterLoaded, onGuestsLoaded]);

  /**
   * Rellena los nombres cuando el catálogo llega tarde.
   *
   * La cuenta de la mesa guarda identificadores, no nombres. Si la respuesta de la mesa llega
   * antes que el catálogo —lo normal en una conexión lenta— el carrito se pinta con UUID
   * donde debería ir «Hamburguesa». Esto lo corrige en cuanto el catálogo aparece.
   */
  useEffect(() => {
    if (cachedProducts.length === 0 || cartItems.length === 0) return;

    let cambio = false;
    const parcheados = cartItems.map((item) => {
      if (item.name !== item.productId && item.name) return item;
      const producto = cachedProducts.find((p) => p.id === item.productId);
      if (!producto) return item;
      cambio = true;
      return {
        ...item,
        name: producto.name,
        category: producto.category,
        barcode: producto.barcode,
        imageUrl: producto.imageUrl,
        variantName: item.variantId
          ? producto.variants?.find((v: { id: string; name: string }) => v.id === item.variantId)?.name ?? item.variantName
          : item.variantName
      };
    });

    if (cambio) setCartItems(parcheados);
  }, [cachedProducts, cartItems, setCartItems]);
}

function conDatosDelCatalogo(item: TableOrderItem, cachedProducts: ProductItem[]): CartItem {
  const producto = cachedProducts.find((p) => p.id === item.productId);

  return {
    productId: item.productId,
    variantId: item.variantId,
    // Sin catálogo todavía, el identificador hace de nombre: el segundo efecto lo corrige.
    name: producto?.name ?? item.productId,
    category: producto?.category ?? '',
    barcode: producto?.barcode ?? null,
    priceCents: item.priceCents,
    imageUrl: producto?.imageUrl ?? null,
    qty: item.qty,
    notes: item.notes || undefined,
    course: item.course,
    variantName: item.variantId
      ? producto?.variants?.find((v: { id: string; name: string }) => v.id === item.variantId)?.name
      : undefined
  } as CartItem;
}
