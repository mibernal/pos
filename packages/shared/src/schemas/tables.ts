import { z } from 'zod';

export const TABLE_STATUS = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'BILLING', 'OUT_OF_ORDER'] as const;
export type TableStatus = typeof TABLE_STATUS[number];

export const RoomSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string().min(1, 'El nombre del salón es requerido').max(100),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Room = z.infer<typeof RoomSchema>;

export const TableSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  branchId: z.string().uuid(),
  roomId: z.string().uuid(),
  name: z.string().min(1, 'El nombre de la mesa es requerido').max(100),
  capacity: z.number().int().min(1).max(100),
  status: z.enum(TABLE_STATUS),
  currentOrderId: z.string().uuid().nullable(),
  statusUpdatedAt: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Table = z.infer<typeof TableSchema>;

// -- API Payloads --

export const CreateRoomSchema = z.object({
  name: z.string().min(1, 'El nombre del salón es requerido').max(100)
});
export type CreateRoomPayload = z.infer<typeof CreateRoomSchema>;

export const UpdateRoomSchema = z.object({
  name: z.string().min(1, 'El nombre del salón es requerido').max(100).optional(),
  isActive: z.boolean().optional()
});
export type UpdateRoomPayload = z.infer<typeof UpdateRoomSchema>;

export const CreateTableSchema = z.object({
  name: z.string().min(1, 'El nombre de la mesa es requerido').max(100),
  capacity: z.number().int().min(1).max(100).default(4)
});
export type CreateTablePayload = z.infer<typeof CreateTableSchema>;

export const UpdateTableSchema = z.object({
  name: z.string().min(1, 'El nombre de la mesa es requerido').max(100).optional(),
  capacity: z.number().int().min(1).max(100).optional(),
  isActive: z.boolean().optional()
});
export type UpdateTablePayload = z.infer<typeof UpdateTableSchema>;

export const UpdateTableStatusSchema = z.object({
  status: z.enum(TABLE_STATUS),
  currentOrderId: z.string().uuid().nullable().optional()
});
export type UpdateTableStatusPayload = z.infer<typeof UpdateTableStatusSchema>;

export const TableOrderItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  productName: z.string().optional(), // For UI
  variantName: z.string().optional(), // For UI
  imageUrl: z.string().nullable().optional(), // For UI
  description: z.string().nullable().optional(), // For UI
  qty: z.number().int().positive(),
  priceCents: z.number().int().nonnegative(),
  lineTotalCents: z.number().int().nonnegative()
});
export type TableOrderItem = z.infer<typeof TableOrderItemSchema>;

export const TableOrderSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  branchId: z.string().uuid(),
  tableId: z.string().uuid(),
  status: z.string(), // OPEN
  subtotalCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type TableOrder = z.infer<typeof TableOrderSchema>;

export const TableOrderWithItemsSchema = z.object({
  order: TableOrderSchema,
  items: z.array(TableOrderItemSchema)
});
export type TableOrderWithItems = z.infer<typeof TableOrderWithItemsSchema>;

export const SaveTableOrderPayloadSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullable().optional(),
    qty: z.number().int().positive(),
    priceCents: z.number().int().nonnegative(),
    lineTotalCents: z.number().int().nonnegative()
  }))
});
export type SaveTableOrderPayload = z.infer<typeof SaveTableOrderPayloadSchema>;

export const RoomWithTablesSchema = RoomSchema.extend({
  tables: z.array(TableSchema.extend({
    // Injected dynamically by the API — total consumed by the active order
    currentTotalCents: z.number().nullable().optional(),
    // ISO timestamp of when the active order was first created (for restaurant-accurate occupation timer)
    orderCreatedAt: z.string().nullable().optional()
  }))
});
export type RoomWithTables = z.infer<typeof RoomWithTablesSchema>;

export const TransferTablePayloadSchema = z.object({
  destinationTableId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullable().optional(),
    qty: z.number().int().positive()
  })).optional() // Si es undefined, transfiere toda la mesa.
});
export type TransferTablePayload = z.infer<typeof TransferTablePayloadSchema>;
