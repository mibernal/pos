import { z } from 'zod';

export const dianProviderTaxModeSchema = z.enum(['IVA', 'INC_RESTAURANT']);
export const dianProviderDocumentTypeSchema = z.enum(['INVOICE', 'CREDIT_NOTE']);
export const dianProviderTaxCategorySchema = z.enum([
  'IVA_0',
  'IVA_5',
  'IVA_19',
  'EXEMPT',
  'EXCLUDED',
  'INC_8',
  'INC'
]);

export const dianProviderPaymentMethodSchema = z.enum(['CASH', 'CARD', 'TRANSFER']);
export const dianProviderPaymentModeSchema = z.enum(['CASH', 'CARD', 'TRANSFER', 'MIXED']);

export const dianProviderPaymentBreakdownSchema = z.object({
  mode: dianProviderPaymentModeSchema,
  total_cents: z.number().int().nonnegative(),
  amounts: z.object({
    cash_cents: z.number().int().nonnegative(),
    card_cents: z.number().int().nonnegative(),
    transfer_cents: z.number().int().nonnegative()
  }),
  payments: z.array(
    z.object({
      method: dianProviderPaymentMethodSchema,
      amount_cents: z.number().int().nonnegative()
    })
  )
});

export const dianProviderTaxLineSchema = z.object({
  lineIndex: z.number().int().nonnegative(),
  category: dianProviderTaxCategorySchema,
  base_cents: z.number().int().nonnegative(),
  tax_cents: z.number().int().nonnegative(),
  rate: z.number().nonnegative()
});

export const dianProviderSaleItemSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_name: z.string().min(1),
  barcode: z.string().min(1).nullable(),
  tax_category: dianProviderTaxCategorySchema,
  category: dianProviderTaxCategorySchema,
  base_cents: z.number().int().nonnegative(),
  tax_cents: z.number().int().nonnegative(),
  rate: z.number().nonnegative(),
  qty: z.number().positive(),
  price_cents: z.number().int().nonnegative(),
  line_total_cents: z.number().int().nonnegative()
});

export const dianProviderEmitSaleInputSchema = z.object({
  sale_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  document_type: dianProviderDocumentTypeSchema.optional(),
  void_reason: z.string().min(1).optional(),
  taxMode: dianProviderTaxModeSchema,
  idempotency_key: z.string().min(1),
  tenant: z.object({
    id: z.string().uuid(),
    nit: z.string().min(1),
    name: z.string().min(1),
    business_name: z.string().min(1)
  }),
  branch: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    address: z.string().min(1)
  }),
  sale: z.object({
    id: z.string().uuid(),
    sale_number: z.number().int().positive(),
    created_at: z.string().datetime(),
    subtotal_cents: z.number().int().nonnegative(),
    discount_cents: z.number().int().nonnegative(),
    total_cents: z.number().int().nonnegative(),
    tax_total_cents: z.number().int().nonnegative(),
    tax_lines: z.array(dianProviderTaxLineSchema),
    payments: dianProviderPaymentBreakdownSchema,
    items: z.array(dianProviderSaleItemSchema)
  })
});

export type DianProviderEmitSaleInputSchemaInput = z.infer<typeof dianProviderEmitSaleInputSchema>;
