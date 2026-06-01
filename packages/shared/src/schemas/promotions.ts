import { z } from 'zod';


export const promotionTypeSchema = z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'BUY_X_GET_Y']);
export type PromotionType = z.infer<typeof promotionTypeSchema>;

export const promotionSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  product_id: z.string().uuid(),
  type: promotionTypeSchema,
  value_cents: z.number().int(),
  buy_qty: z.number().int().nullable(),
  get_qty: z.number().int().nullable(),
  start_date: z.string(),
  end_date: z.string().nullable(),
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string()
});

export type Promotion = z.infer<typeof promotionSchema>;

const createPromotionBaseSchema = z.object({
  product_id: z.string().uuid(),
  type: promotionTypeSchema,
  value_cents: z.number().int().min(1, 'El valor no puede ser menor a 1'),
  buy_qty: z.number().int().min(2, 'La cantidad de compra mínima es 2').optional().nullable(),
  get_qty: z.number().int().min(1, 'La cantidad gratuita mínima es 1').optional().nullable(),
  start_date: z.string().datetime(),
  end_date: z.string().datetime().optional().nullable(),
  active: z.boolean().default(true)
});

export const createPromotionSchema = createPromotionBaseSchema.refine(data => {
  if (data.type === 'PERCENTAGE' && data.value_cents > 10000) return false;
  return true;
}, {
  message: 'El porcentaje no puede ser mayor al 100% (10000)',
  path: ['value_cents']
}).refine(data => {
  if (data.type === 'BUY_X_GET_Y') {
    return data.buy_qty !== null && data.buy_qty !== undefined && data.buy_qty >= 2 &&
           data.get_qty !== null && data.get_qty !== undefined && data.get_qty >= 1;
  }
  return true;
}, {
  message: 'Debes definir cantidades válidas para promociones Pague X Lleve Y',
  path: ['type']
});

export type CreatePromotion = z.infer<typeof createPromotionSchema>;

export const updatePromotionSchema = createPromotionBaseSchema.omit({ product_id: true }).partial();
export type UpdatePromotion = z.infer<typeof updatePromotionSchema>;

export const listPromotionsQuerySchema = z.object({
  product_id: z.string().uuid().optional(),
  active: z.coerce.boolean().optional()
});

export type ListPromotionsQuery = z.infer<typeof listPromotionsQuerySchema>;
