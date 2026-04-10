import { z } from 'zod';

export const salesReportQuerySchema = z.object({
  branch_id: z.string().uuid('branch_id debe ser un UUID válido'),
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

export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
export type SalesReportResponse = z.infer<typeof salesReportResponseSchema>;
