import { z } from 'zod';

export const DELIVERY_STATUS = ['PENDING', 'PREPARING', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED'] as const;
export type DeliveryStatus = typeof DELIVERY_STATUS[number];

export const DeliveryPersonSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string().min(1, 'El nombre es requerido').max(100),
  phone: z.string().min(1, 'El teléfono es requerido').max(20),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type DeliveryPerson = z.infer<typeof DeliveryPersonSchema>;

export const DeliveryItemSchema = z.object({
  id: z.string().uuid(),
  deliveryId: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  qty: z.number().positive(),
  priceCents: z.number().int().nonnegative(),
  lineTotalCents: z.number().int().nonnegative()
});
export type DeliveryItem = z.infer<typeof DeliveryItemSchema>;

export const DeliverySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  branchId: z.string().uuid(),
  saleId: z.string().uuid().nullable().optional(),
  status: z.enum(DELIVERY_STATUS),
  customerName: z.string().min(1, 'El nombre del cliente es requerido').max(100),
  customerPhone: z.string().min(1, 'El teléfono es requerido').max(20),
  deliveryAddress: z.string().min(1, 'La dirección es requerida').max(255),
  deliveryNeighborhood: z.string().max(100).nullable().optional(),
  deliveryNotes: z.string().max(500).nullable().optional(),
  deliveryPersonId: z.string().uuid().nullable().optional(),
  totalCents: z.number().int().nonnegative(),
  statusUpdatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type Delivery = z.infer<typeof DeliverySchema>;

export const DeliveryWithItemsSchema = DeliverySchema.extend({
  items: z.array(DeliveryItemSchema)
});
export type DeliveryWithItems = z.infer<typeof DeliveryWithItemsSchema>;

export const DeliveryWithDetailsSchema = DeliveryWithItemsSchema.extend({
  deliveryPerson: DeliveryPersonSchema.nullable().optional()
});
export type DeliveryWithDetails = z.infer<typeof DeliveryWithDetailsSchema>;

// -- API Payloads --

export const CreateDeliveryPersonSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(100),
  phone: z.string().min(1, 'El teléfono es requerido').max(20)
});
export type CreateDeliveryPersonPayload = z.infer<typeof CreateDeliveryPersonSchema>;

export const UpdateDeliveryPersonSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(100).optional(),
  phone: z.string().min(1, 'El teléfono es requerido').max(20).optional(),
  isActive: z.boolean().optional()
});
export type UpdateDeliveryPersonPayload = z.infer<typeof UpdateDeliveryPersonSchema>;

export const CreateDeliveryItemPayloadSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  qty: z.number().positive(),
  priceCents: z.number().int().nonnegative()
});
export type CreateDeliveryItemPayload = z.infer<typeof CreateDeliveryItemPayloadSchema>;

export const CreateDeliverySchema = z.object({
  customerName: z.string().min(1, 'El nombre del cliente es requerido').max(100),
  customerPhone: z.string().min(1, 'El teléfono es requerido').max(20),
  deliveryAddress: z.string().min(1, 'La dirección es requerida').max(255),
  deliveryNeighborhood: z.string().max(100).nullable().optional(),
  deliveryNotes: z.string().max(500).nullable().optional(),
  items: z.array(CreateDeliveryItemPayloadSchema).min(1, 'Debe haber al menos un producto')
});
export type CreateDeliveryPayload = z.infer<typeof CreateDeliverySchema>;

export const UpdateDeliveryStatusSchema = z.object({
  status: z.enum(DELIVERY_STATUS),
  saleId: z.string().uuid().nullable().optional()
});
export type UpdateDeliveryStatusPayload = z.infer<typeof UpdateDeliveryStatusSchema>;

export const AssignDeliveryPersonSchema = z.object({
  deliveryPersonId: z.string().uuid()
});
export type AssignDeliveryPersonPayload = z.infer<typeof AssignDeliveryPersonSchema>;
