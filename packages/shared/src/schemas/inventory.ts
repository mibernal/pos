import { z } from 'zod';

export const inventoryOperationSchema = z.enum([
  'SALE',
  'SALE_VOID',
  'MANUAL_ENTRY',
  'MANUAL_EXIT',
  'PURCHASE'
]);

export const inventoryBalanceSchema = z.object({
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  product_id: z.string().uuid(),
  qty: z.number(),
  updated_at: z.string().datetime()
});

export type InventoryBalance = z.infer<typeof inventoryBalanceSchema>;

export const inventoryTransactionSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  product_id: z.string().uuid(),
  operation: inventoryOperationSchema,
  reference_id: z.string().uuid().nullable(),
  qty_change: z.number(),
  notes: z.string().nullable(),
  created_by_user_id: z.string().uuid(),
  created_at: z.string().datetime()
});

export type InventoryTransaction = z.infer<typeof inventoryTransactionSchema>;

export const createInventoryTransactionBodySchema = z.object({
  branch_id: z.string().uuid(),
  product_id: z.string().uuid(),
  operation: z.enum(['MANUAL_ENTRY', 'MANUAL_EXIT', 'PURCHASE']),
  qty_change: z.number().refine(val => val !== 0, 'La cantidad no puede ser cero'),
  notes: z.string().optional().nullable()
});

export type CreateInventoryTransactionInput = z.infer<typeof createInventoryTransactionBodySchema>;

export const inventoryBalancesQuerySchema = z.object({
  branch_id: z.string().uuid(),
  product_id: z.string().uuid().optional()
});
