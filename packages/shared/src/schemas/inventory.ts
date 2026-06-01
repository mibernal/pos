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
  variant_id: z.string().uuid().nullable().optional(),
  on_hand_qty: z.number(),
  reserved_qty: z.number(),
  in_transit_qty: z.number(),
  updated_at: z.string().datetime()
});

export type InventoryBalance = z.infer<typeof inventoryBalanceSchema>;

export const inventoryTransactionSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().optional(),
  operation: inventoryOperationSchema,
  reference_id: z.string().uuid().nullable(),
  qty_change: z.number(),
  balance_after: z.number().nullable(),
  notes: z.string().nullable(),
  created_by_user_id: z.string().uuid(),
  created_at: z.string().datetime()
});

export type InventoryTransaction = z.infer<typeof inventoryTransactionSchema>;

export const createInventoryTransactionBodySchema = z.object({
  branch_id: z.string().uuid(),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().optional(),
  operation: z.enum(['MANUAL_ENTRY', 'MANUAL_EXIT', 'PURCHASE']),
  qty_change: z.number().refine(val => val !== 0, 'La cantidad no puede ser cero'),
  notes: z.string().optional().nullable()
});

export type CreateInventoryTransactionInput = z.infer<typeof createInventoryTransactionBodySchema>;

export const inventoryBalancesQuerySchema = z.object({
  branch_id: z.string().uuid(),
  product_id: z.string().uuid().optional(),
  variant_id: z.string().uuid().optional()
});

export const consolidatedInventoryResponseSchema = z.array(z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  category: z.string(),
  image_url: z.string().nullable(),
  variant_id: z.string().uuid().nullable().optional(),
  total_on_hand_qty: z.number(),
  total_reserved_qty: z.number(),
  total_in_transit_qty: z.number(),
  branches_breakdown: z.array(z.object({
    branch_id: z.string().uuid(),
    branch_name: z.string(),
    on_hand_qty: z.number(),
    reserved_qty: z.number(),
    in_transit_qty: z.number()
  }))
}));

export type ConsolidatedInventoryResponse = z.infer<typeof consolidatedInventoryResponseSchema>;

export const createTransferBodySchema = z.object({
  from_branch_id: z.string().uuid(),
  to_branch_id: z.string().uuid(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    variant_id: z.string().uuid().optional().nullable(),
    qty: z.coerce.number().positive()
  })).min(1)
});

export const shipTransferBodySchema = z.object({
  notes: z.string().optional().nullable()
});

export const receiveTransferBodySchema = z.object({
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    item_id: z.string().uuid(),
    received_qty: z.coerce.number().min(0)
  })).min(1)
});

// Fase 4: Scanner and Counts

export const scanBatchBodySchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    variant_id: z.string().uuid().optional().nullable(),
    scanned_qty_delta: z.coerce.number().positive() // Must be delta to prevent concurrency issues
  })).min(1)
});

export const commitReceiptBodySchema = z.object({
  discrepancy_approved_by_pin: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

export const createCountBodySchema = z.object({
  branch_id: z.string().uuid(),
  name: z.string().min(1)
});

export const commitCountBodySchema = z.object({
  discrepancy_approved_by_pin: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

