import { z } from 'zod';

export const salesReportQuerySchema = z.object({
  branch_id: z.string().uuid('branch_id debe ser un UUID válido'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

export const kardexQuerySchema = z.object({
  branch_id: z.string().uuid(),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

export const salesReportResponseSchema = z.object({
  total_revenue_cents: z.number(),
  total_sales_count: z.number(),
  average_ticket_cents: z.number(),
  revenue_by_method: z.array(
    z.object({
      method: z.string(),
      amount_cents: z.number()
    })
  )
});

export const shiftsReportQuerySchema = z.object({
  branch_id: z.string().uuid('branch_id debe ser un UUID válido'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

export const shiftReportItemSchema = z.object({
  id: z.string(),
  branch_id: z.string(),
  opened_at: z.string(),
  closed_at: z.string().nullable(),
  opened_by_user_id: z.string(),
  user_name: z.string(),
  opening_amount_cents: z.number(),
  closing_cash_real_cents: z.number().nullable(),
  expected_cash_cents: z.number().nullable(),
  diff_cents: z.number().nullable()
});

export const shiftsReportResponseSchema = z.object({
  items: z.array(shiftReportItemSchema)
});

export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
export type SalesReportResponse = z.infer<typeof salesReportResponseSchema>;
export type ShiftsReportQuery = z.infer<typeof shiftsReportQuerySchema>;
export type ShiftsReportResponse = z.infer<typeof shiftsReportResponseSchema>;
