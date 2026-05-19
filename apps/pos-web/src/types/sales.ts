import type { TicketPrintItem } from '../lib/ticket-printer';
import type { SalesListItem } from '../lib/api';

export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'MIXED';

export interface CartItem {
  productId: string;
  variantId?: string | null;
  name: string;
  variantName?: string | null;
  category: string;
  barcode: string | null;
  priceCents: number;
  qty: number;
  imageUrl?: string | null;
  description?: string | null;
  promotion?: {
    type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'BUY_X_GET_Y';
    value_cents: number;
    buy_qty: number | null;
    get_qty: number | null;
  } | null;
}

export interface LastPrintedSaleSnapshot {
  sale: SalesListItem;
  items: TicketPrintItem[];
}
