import { z } from 'zod';

/**
 * Pedido desde el menú QR.
 *
 * El comensal escanea el código de su mesa, ve la carta y pide desde su móvil. Lo que
 * escribe entra por la misma puerta que usa el mesero —cuenta de mesa, ronda, comanda de
 * cocina— porque un pedido que llega por otro camino es un pedido que la cocina no ve.
 */

export const qrOrderItemSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().optional(),
  qty: z.number().int().positive().max(20),
  notes: z.string().max(200).optional()
});
export type QrOrderItem = z.infer<typeof qrOrderItemSchema>;

/**
 * El pedido **no lleva precios**.
 *
 * Los pone el servidor a partir del catálogo. Si el precio viniera del móvil del cliente, la
 * carta sería una sugerencia: bastaría con editar la petición para cenar por mil pesos.
 */
export const qrOrderSchema = z.object({
  items: z.array(qrOrderItemSchema).min(1).max(30)
});
export type QrOrderInput = z.infer<typeof qrOrderSchema>;

export const qrMenuProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  price_cents: z.number().int(),
  image_url: z.string().nullable()
});

export const qrMenuCategorySchema = z.object({
  name: z.string(),
  products: z.array(qrMenuProductSchema)
});

export const qrOrderLineSchema = z.object({
  product_name: z.string(),
  qty: z.number(),
  line_total_cents: z.number().int(),
  /** `QR` si lo pidió el comensal desde su móvil, `POS` si lo tomó el mesero. */
  source: z.string()
});

export const qrTableViewSchema = z.object({
  branch_name: z.string(),
  table_name: z.string(),
  menu: z.array(qrMenuCategorySchema),
  order: z
    .object({
      lines: z.array(qrOrderLineSchema),
      total_cents: z.number().int(),
      bill_requested: z.boolean()
    })
    .nullable()
});
export type QrTableView = z.infer<typeof qrTableViewSchema>;
