import type { TicketPrintItem } from '../lib/ticket-printer';
import type { SalesListItem } from '../lib/api';

export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'MIXED';

export interface CartItem {
  productId: string;
  name: string;
  category: string;
  barcode: string | null;
  priceCents: number;
  qty: number;
  imageUrl?: string | null;
  description?: string | null;
}

export interface LastPrintedSaleSnapshot {
  sale: SalesListItem;
  items: TicketPrintItem[];
}
