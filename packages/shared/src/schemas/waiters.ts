import { z } from 'zod';

/**
 * El PIN es de escritura solamente.
 *
 * `WaiterSchema` describe lo que la API **devuelve**, y devolver el PIN era el defecto:
 * `GET /branches/:branchId/waiters` está abierto a cualquiera con el módulo activo, porque
 * lo consume el selector de mesero que maneja un cajero. Quien pedía la lista se llevaba
 * los PIN de toda la sucursal. Hacia fuera solo viaja `has_pin`; el valor entra por
 * `CreateWaiterSchema` / `UpdateWaiterSchema` y se guarda hasheado.
 */
const pinSchema = z
  .string()
  .trim()
  .min(4, 'El PIN debe tener al menos 4 dígitos')
  .max(12, 'El PIN no puede superar los 12 dígitos')
  .regex(/^\d+$/, 'El PIN solo puede contener dígitos');

export const WaiterSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  name: z.string().min(1).max(255),
  has_pin: z.boolean(),
  is_active: z.boolean(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type Waiter = z.infer<typeof WaiterSchema>;

export const CreateWaiterSchema = z.object({
  name: z.string().min(1).max(255),
  pin: pinSchema.nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
});

export type CreateWaiterPayload = z.infer<typeof CreateWaiterSchema>;

export const UpdateWaiterSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  // `null` borra el PIN; omitirlo lo deja como está.
  pin: pinSchema.nullable().optional(),
  is_active: z.boolean().optional(),
  user_id: z.string().uuid().nullable().optional(),
});

export type UpdateWaiterPayload = z.infer<typeof UpdateWaiterSchema>;
