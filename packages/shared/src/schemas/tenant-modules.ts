import { z } from 'zod';

export const UpdateTenantModulesSchema = z.object({
  modules: z.object({
    enable_tables: z.boolean().optional(),
    enable_delivery: z.boolean().optional(),
    enable_waiters: z.boolean().optional(),
    enable_split_bill: z.boolean().optional(),
    enable_tips: z.boolean().optional(),
    enable_kitchen: z.boolean().optional(),
    enable_kitchen_display: z.boolean().optional(),
    enable_kitchen_tickets: z.boolean().optional(),
    enable_kitchen_printing: z.boolean().optional(),
    enable_order_rounds: z.boolean().optional(),
    enable_product_modifiers: z.boolean().optional(),
    enable_reservations: z.boolean().optional(),
    enable_waiter_shifts: z.boolean().optional(),
    enable_qr_menu: z.boolean().optional(),
    enable_guests_count: z.boolean().optional(),
    enable_restaurant: z.boolean().optional(),
    enable_kds: z.boolean().optional(),
    enable_inventory: z.boolean().optional(),
    enable_fiscal: z.boolean().optional(),
    enable_loyalty: z.boolean().optional(),
    enable_advanced_reports: z.boolean().optional()
  }),
  reason: z.string().min(5, 'A reason must be provided for audit purposes')
});

export type UpdateTenantModulesInput = z.infer<typeof UpdateTenantModulesSchema>;
