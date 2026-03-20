import { z } from 'zod';
import {
  createSaleBodySchema,
  mixedSalePaymentSchema,
  salePaymentSchema,
  simpleSalePaymentSchema,
  voidSaleBodySchema
} from '@pos-dian/shared';

export {
  createSaleBodySchema,
  mixedSalePaymentSchema as mixedPaymentSchema,
  salePaymentSchema,
  simpleSalePaymentSchema as simplePaymentSchema,
  voidSaleBodySchema
};

export const salesListQuerySchema = z.object({
  branch_id: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20)
});

export const saleIdParamsSchema = z.object({
  id: z.string().uuid()
});

export type SimplePaymentInput = z.infer<typeof simpleSalePaymentSchema>;
export type MixedPaymentInput = z.infer<typeof mixedSalePaymentSchema>;
export type SalePaymentInput = z.infer<typeof salePaymentSchema>;
export type CreateSaleBodyInput = z.infer<typeof createSaleBodySchema>;
export type VoidSaleBodyInput = z.infer<typeof voidSaleBodySchema>;
