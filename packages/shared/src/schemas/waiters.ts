import { z } from 'zod';

export const WaiterSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  name: z.string().min(1).max(255),
  pin: z.string().max(20).nullable(),
  is_active: z.boolean(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type Waiter = z.infer<typeof WaiterSchema>;

export const CreateWaiterSchema = z.object({
  name: z.string().min(1).max(255),
  pin: z.string().max(20).nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
});

export type CreateWaiterPayload = z.infer<typeof CreateWaiterSchema>;

export const UpdateWaiterSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  pin: z.string().max(20).nullable().optional(),
  is_active: z.boolean().optional(),
  user_id: z.string().uuid().nullable().optional(),
});

export type UpdateWaiterPayload = z.infer<typeof UpdateWaiterSchema>;
