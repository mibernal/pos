import { z } from 'zod';

export const RESERVATION_STATUS = ['PENDING', 'CONFIRMED', 'SEATED', 'CANCELLED', 'NO_SHOW'] as const;
export type ReservationStatus = typeof RESERVATION_STATUS[number];

export const ReservationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  branchId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  customerName: z.string().min(1, 'El nombre es requerido').max(100),
  customerPhone: z.string().max(50).nullable().optional(),
  tableId: z.string().uuid().nullable().optional(),
  reservationDate: z.string(), // ISO string
  guestsCount: z.number().int().min(1).default(2),
  status: z.enum(RESERVATION_STATUS),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Reservation = z.infer<typeof ReservationSchema>;

export const CreateReservationSchema = z.object({
  customerId: z.string().uuid().nullable().optional(),
  customerName: z.string().min(1, 'El nombre es requerido').max(100),
  customerPhone: z.string().max(50).nullable().optional(),
  tableId: z.string().uuid().nullable().optional(),
  reservationDate: z.string().datetime(), // Strict ISO 8601 validation
  guestsCount: z.number().int().min(1).default(2),
  notes: z.string().nullable().optional()
});
export type CreateReservationPayload = z.infer<typeof CreateReservationSchema>;

export const UpdateReservationSchema = CreateReservationSchema.extend({
  status: z.enum(RESERVATION_STATUS).optional()
}).partial();
export type UpdateReservationPayload = z.infer<typeof UpdateReservationSchema>;

export const UpdateReservationStatusSchema = z.object({
  status: z.enum(RESERVATION_STATUS)
});
export type UpdateReservationStatusPayload = z.infer<typeof UpdateReservationStatusSchema>;
