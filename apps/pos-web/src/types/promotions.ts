export type PromotionType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'BUY_X_GET_Y';

export interface Promotion {
  id: string;
  tenant_id: string;
  product_id: string;
  type: PromotionType;
  value_cents: number;
  buy_qty: number | null;
  get_qty: number | null;
  start_date: string;
  end_date: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreatePromotion {
  product_id: string;
  type: PromotionType;
  value_cents: number;
  buy_qty?: number | null;
  get_qty?: number | null;
  start_date: string;
  end_date?: string | null;
  active?: boolean;
}

export interface UpdatePromotion {
  type?: PromotionType;
  value_cents?: number;
  buy_qty?: number | null;
  get_qty?: number | null;
  start_date?: string;
  end_date?: string | null;
  active?: boolean;
}
