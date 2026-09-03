import { z } from 'zod';
import { paymentKindSchema } from './payments.js';

/**
 * Cuentas por cobrar: el fiado.
 *
 * En una tienda de barrio colombiana esto no es una función avanzada, es la forma normal de
 * vender a la clientela conocida. Sin cupo, abonos y estado de cuenta el comercio lo lleva
 * en un cuaderno, y el POS se queda fuera de la mitad de su operación.
 */

export const RECEIVABLE_STATUSES = ['OPEN', 'PAID', 'WRITTEN_OFF', 'VOID'] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

export const RECEIVABLE_STATUS_LABELS: Record<ReceivableStatus, string> = {
  OPEN: 'Pendiente',
  PAID: 'Pagada',
  WRITTEN_OFF: 'Castigada',
  VOID: 'Anulada'
};

/** `null` en el cupo es sin límite. `0` es un cliente al que no se le fía. */
export const UNLIMITED_CREDIT = null;

export const creditAccountSchema = z.object({
  customer_id: z.string().uuid(),
  customer_name: z.string(),
  credit_limit_cents: z.number().int().nullable(),
  terms_days: z.number().int(),
  status: z.enum(['ACTIVE', 'BLOCKED']),
  /** Derivado de los documentos pendientes, nunca un contador guardado. */
  balance_cents: z.number().int(),
  available_cents: z.number().int().nullable(),
  overdue_cents: z.number().int(),
  oldest_due_at: z.string().nullable(),
  notes: z.string().nullable()
});
export type CreditAccount = z.infer<typeof creditAccountSchema>;

export const upsertCreditAccountSchema = z.object({
  credit_limit_cents: z.number().int().min(0).max(1_000_000_000).nullable(),
  terms_days: z.number().int().min(0).max(365).default(30),
  status: z.enum(['ACTIVE', 'BLOCKED']).default('ACTIVE'),
  notes: z.string().max(300).optional()
});
export type UpsertCreditAccountInput = z.infer<typeof upsertCreditAccountSchema>;

export const receivableSchema = z.object({
  id: z.string().uuid(),
  sale_id: z.string().uuid().nullable(),
  sale_number: z.number().int().nullable(),
  original_cents: z.number().int(),
  balance_cents: z.number().int(),
  status: z.enum(RECEIVABLE_STATUSES),
  due_at: z.string().nullable(),
  overdue: z.boolean(),
  created_at: z.string()
});
export type Receivable = z.infer<typeof receivableSchema>;

export const receivablePaymentSchema = z.object({
  id: z.string().uuid(),
  amount_cents: z.number().int(),
  method_code: z.string(),
  kind: paymentKindSchema,
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  allocations: z.array(
    z.object({
      receivable_id: z.string().uuid(),
      amount_cents: z.number().int()
    })
  )
});
export type ReceivablePayment = z.infer<typeof receivablePaymentSchema>;

/**
 * Registrar un abono.
 *
 * `receivable_id` es opcional: sin él, el abono se imputa a los documentos más antiguos
 * primero, que es como se cobra en la práctica —el cliente llega y dice «le abono
 * cincuenta»— y evita que quede plata sin asignar a ningún documento.
 */
export const registerReceivablePaymentSchema = z.object({
  amount_cents: z.number().int().positive().max(1_000_000_000),
  method_code: z.string().min(2).max(30).default('CASH'),
  method: paymentKindSchema.default('CASH'),
  /** El turno en el que se recibe. Obligatorio si el abono es en efectivo. */
  cash_session_id: z.string().uuid().optional(),
  branch_id: z.string().uuid(),
  reference: z.string().max(80).optional(),
  notes: z.string().max(300).optional(),
  receivable_id: z.string().uuid().optional()
});
export type RegisterReceivablePaymentInput = z.infer<typeof registerReceivablePaymentSchema>;

export const customerStatementSchema = z.object({
  account: creditAccountSchema,
  receivables: z.array(receivableSchema),
  payments: z.array(receivablePaymentSchema)
});
export type CustomerStatement = z.infer<typeof customerStatementSchema>;

/**
 * Cuánto cupo le queda a un cliente.
 *
 * Sin límite devuelve `null`, que **no** es lo mismo que cero — confundirlos es lo que
 * haría que a un cliente sin tope se le rechazara la primera venta a crédito.
 */
export function availableCreditCents(limitCents: number | null, balanceCents: number): number | null {
  if (limitCents === null) return null;
  return Math.max(0, limitCents - balanceCents);
}
