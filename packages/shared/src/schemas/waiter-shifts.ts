import { z } from 'zod';

/**
 * Turnos de mesero.
 *
 * El turno de un mesero no es el turno de caja. En un restaurante la caja abre una vez por
 * día y los meseros entran y salen dentro de ella; la propina se liquida por quien la
 * trabajó, no por quien cerró el cajón. `enable_waiter_shifts` llevaba tiempo siendo un
 * interruptor sin nada detrás.
 */

export const openWaiterShiftSchema = z.object({
  branch_id: z.string().uuid(),
  /**
   * El mesero entra con su PIN. Es la primera vez que el PIN sirve para algo: hasta ahora se
   * guardaba hasheado, se exigía único por sucursal y nada lo verificaba nunca.
   */
  pin: z.string().min(4).max(10).optional(),
  /** Alternativa al PIN, para que un administrador abra el turno de alguien. */
  waiter_id: z.string().uuid().optional(),
  cash_session_id: z.string().uuid().nullable().optional(),
  /** El rango de mesas que le toca atender. */
  table_ids: z.array(z.string().uuid()).max(60).optional(),
  notes: z.string().max(300).optional()
}).refine((valor) => Boolean(valor.pin) || Boolean(valor.waiter_id), {
  message: 'Hace falta el PIN del mesero o su identificador'
});
export type OpenWaiterShiftInput = z.infer<typeof openWaiterShiftSchema>;

export const closeWaiterShiftSchema = z.object({
  notes: z.string().max(300).optional()
});
export type CloseWaiterShiftInput = z.infer<typeof closeWaiterShiftSchema>;

/**
 * El corte del turno.
 *
 * Lo que el mesero necesita ver al salir y lo que el encargado necesita para pagarle: qué
 * vendió, cuánta propina generó y cuánta de esa propina está en el cajón —la que se le puede
 * entregar hoy— frente a la que cobró el comercio por tarjeta y se paga con la nómina.
 */
export const waiterShiftSummarySchema = z.object({
  shift_id: z.string().uuid(),
  waiter_id: z.string().uuid(),
  waiter_name: z.string(),
  opened_at: z.string(),
  closed_at: z.string().nullable(),
  sales_count: z.number().int(),
  sales_total_cents: z.number().int(),
  tips_total_cents: z.number().int(),
  tips_cash_cents: z.number().int(),
  tips_electronic_cents: z.number().int(),
  tables_served: z.number().int(),
  guests_served: z.number().int()
});
export type WaiterShiftSummary = z.infer<typeof waiterShiftSummarySchema>;

export const waiterShiftSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  waiter_id: z.string().uuid(),
  waiter_name: z.string(),
  cash_session_id: z.string().uuid().nullable(),
  opened_at: z.string(),
  closed_at: z.string().nullable(),
  notes: z.string().nullable(),
  table_ids: z.array(z.string().uuid())
});
export type WaiterShift = z.infer<typeof waiterShiftSchema>;
