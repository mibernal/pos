import type { TicketTemplateConfig } from '../ticket-template';

export interface TicketPrintItem {
  name: string;
  qty: number;
  priceCents: number;
  lineTotalCents: number;
  notes?: string | null;
}

export interface KitchenTicketInput {
  tableName: string;
  waiterName?: string | null;
  createdAt: string;
  items: Omit<TicketPrintItem, 'priceCents' | 'lineTotalCents'>[];
}

export interface TicketPrintPayment {
  method: 'CASH' | 'CARD' | 'TRANSFER';
  amountCents: number;
}

export interface TicketPrintInput {
  template: TicketTemplateConfig;
  branchName: string;
  branchAddress?: string;
  saleNumber: number;
  createdAt: string;
  saleStatus?: 'COMPLETED' | 'VOID';
  items: TicketPrintItem[];
  subtotalCents: number;
  discountCents: number;
  tipCents: number;
  totalCents: number;
  payments: TicketPrintPayment[];
  taxMode?: 'IVA' | 'INC_RESTAURANT' | 'REGIMEN_SIMPLIFICADO' | null;
  dianStatus: 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | string;
  cude?: string | null;
  voidReason?: string | null;
  voidedAt?: string | null;
  isReprint?: boolean;
}

export interface ZReportTicketInput {
  template: TicketTemplateConfig;
  branchName: string;
  openedAt: string;
  closedAt: string | null;
  saleCount: number;
  totalSalesCents: number;
  paymentBreakdown: Record<string, number>;
  expectedCashCents: number;
  realCashCents: number;
  diffCents: number;
  status: string;
}
