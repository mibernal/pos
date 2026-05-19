import { z } from 'zod';
import { uuidSchema } from './common.js';

export const ReturnItemSchema = z.object({
  product_id: uuidSchema,
  qty: z.number().positive()
});

export const CreateReturnRequestSchema = z.object({
  items: z.array(ReturnItemSchema).min(1),
  reason: z.string().min(1).max(255).optional()
});

export type CreateReturnRequest = z.infer<typeof CreateReturnRequestSchema>;
export type ReturnItem = z.infer<typeof ReturnItemSchema>;

export const ReturnResponseSchema = z.object({
  return_id: uuidSchema,
  total_refund_cents: z.number(),
  status: z.string(),
  message: z.string()
});

export type ReturnResponse = z.infer<typeof ReturnResponseSchema>;
