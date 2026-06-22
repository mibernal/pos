import { z } from 'zod';

export const KitchenTicketSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  round_id: z.string().uuid(),
  table_order_id: z.string().uuid(),
  status: z.enum(['PENDING', 'PREPARING', 'READY', 'DELIVERED']),
  printed_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string()
});
export type KitchenTicket = z.infer<typeof KitchenTicketSchema>;

export const KitchenTicketItemSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  table_order_id: z.string().uuid(),
  round_id: z.string().uuid().nullable().optional(),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().optional(),
  qty: z.number().int().positive(),
  item_status: z.string(),
  modifiers: z.unknown().nullable().optional(),
  notes: z.string().nullable().optional(),
  productName: z.string().optional(),
  variantName: z.string().optional()
});
export type KitchenTicketItem = z.infer<typeof KitchenTicketItemSchema>;

export const KitchenTicketWithItemsSchema = KitchenTicketSchema.extend({
  items: z.array(KitchenTicketItemSchema),
  tableName: z.string().optional() // Para mostrar en el UI
});
export type KitchenTicketWithItems = z.infer<typeof KitchenTicketWithItemsSchema>;

export const UpdateKitchenTicketStatusSchema = z.object({
  status: z.enum(['PENDING', 'PREPARING', 'READY', 'DELIVERED'])
});
export type UpdateKitchenTicketStatusPayload = z.infer<typeof UpdateKitchenTicketStatusSchema>;
