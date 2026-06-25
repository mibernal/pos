import { z } from 'zod';
import { productTaxCategorySchema } from './product.js';

export const saleStatusSchema = z.enum(['COMPLETED', 'VOID']);
export const dianStatusSchema = z.enum(['PENDING', 'SENT', 'ACCEPTED', 'REJECTED']);
export const dianDocumentTypeSchema = z.enum(['INVOICE', 'CREDIT_NOTE']);

export const salePaymentMethodSchema = z.enum(['CASH', 'CARD', 'TRANSFER']);
export const salePaymentModeSchema = z.enum(['CASH', 'CARD', 'TRANSFER', 'MIXED']);
const centsSchema = z.coerce.number().int().nonnegative().max(1_000_000_000);
const positiveCentsSchema = z.coerce.number().int().positive().max(1_000_000_000);
const saleQtySchema = z.coerce.number().positive().max(10_000);

export const simpleSalePaymentSchema = z.object({
  method: salePaymentMethodSchema,
  amount_cents: positiveCentsSchema,
  approval_code: z.string().trim().min(3).max(50).optional()
}).strict();

export const mixedSalePaymentSchema = z.object({
  method: z.literal('MIXED'),
  payments: z.array(simpleSalePaymentSchema).min(2).max(15)
}).strict();

export const salePaymentSchema = z.union([simpleSalePaymentSchema, mixedSalePaymentSchema]);

export const saleItemInputSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().optional().nullable(),
  qty: saleQtySchema,
  price_cents: centsSchema.optional(),
  tax_category: productTaxCategorySchema.optional(),
  notes: z.string().nullable().optional(),
  modifiers: z.array(z.string().uuid()).optional().nullable()
}).strict();

export const createSaleSchema = z.object({
  client_uuid: z.string().uuid(),
  customer_id: z.string().uuid().optional().nullable(),
  branch_id: z.string().uuid(),
  cash_session_id: z.string().uuid(),
  table_order_id: z.string().uuid().optional().nullable(),
  waiterId: z.string().uuid().optional().nullable(),
  items: z.array(saleItemInputSchema).min(1).max(200),
  discount_cents: centsSchema.default(0),
  tip_cents: centsSchema.default(0),
  payments: z.array(salePaymentSchema).min(1).max(15),
  snapshot: z.object({
    subtotal_cents: centsSchema,
    discount_cents: centsSchema,
    tip_cents: centsSchema.optional(),
    tax_total_cents: centsSchema,
    total_cents: centsSchema
  }).optional()
}).strict();

export const createSaleBodySchema = createSaleSchema;

export const voidSaleBodySchema = z.object({
  void_reason: z.string().trim().min(3).max(280)
}).strict();

export const saleTaxCategorySchema = z.union([productTaxCategorySchema, z.literal('INC')]);

export const saleTaxLineSchema = z.object({
  line_index: z.number().int().nonnegative(),
  category: saleTaxCategorySchema,
  base_cents: z.number().int().nonnegative(),
  tax_cents: z.number().int().nonnegative(),
  rate: z.number().nonnegative()
});

export const salePaymentJsonSchema = z.object({
  mode: salePaymentModeSchema,
  total_cents: z.number().int().nonnegative(),
  amounts: z.object({
    cash_cents: z.number().int().nonnegative(),
    card_cents: z.number().int().nonnegative(),
    transfer_cents: z.number().int().nonnegative()
  }),
  payments: z.array(simpleSalePaymentSchema)
});

export const saleSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  customer_id: z.string().uuid().nullable(),
  branch_id: z.string().uuid(),
  cash_session_id: z.string().uuid(),
  table_order_id: z.string().uuid().nullable().optional(),
  waiterId: z.string().uuid().nullable().optional(),
  sale_number: z.number().int().nonnegative(),
  status: saleStatusSchema,
  subtotal_cents: z.number().int().nonnegative(),
  discount_cents: z.number().int().nonnegative(),
  tip_cents: z.number().int().nonnegative(),
  total_cents: z.number().int().nonnegative(),
  tax_total_cents: z.number().int().nonnegative(),
  tax_lines_json: z.array(saleTaxLineSchema),
  payment_json: salePaymentJsonSchema,
  dian_status: dianStatusSchema.nullable(),
  created_by_user_id: z.string().uuid(),
  void_reason: z.string().min(1).nullable(),
  voided_by_user_id: z.string().uuid().nullable(),
  voided_at: z.string().datetime().nullable(),
  created_at: z.string().datetime()
});

export const saleItemSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().optional(),
  qty: z.number().positive(),
  price_cents: z.number().int().nonnegative(),
  line_total_cents: z.number().int().nonnegative()
});

export const createdSaleResponseSchema = z.object({
  sale: saleSchema,
  items: z.array(saleItemSchema)
});

export const salesListResponseSchema = z.object({
  items: z.array(saleSchema),
  page: z.object({
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean()
  })
});

export const saleDetailItemSchema = saleItemSchema.extend({
  product_name: z.string().min(1),
  variant_name: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  description: z.string().nullable().optional()
});

export const saleDianDocumentSchema = z.object({
  id: z.string().uuid(),
  provider: z.string().min(1),
  status: dianStatusSchema,
  cude: z.string().min(1).nullable(),
  document_type: dianDocumentTypeSchema.optional(),
  parent_document_id: z.string().uuid().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const saleDetailResponseSchema = z.object({
  sale: saleSchema,
  items: z.array(saleDetailItemSchema),
  dian_document: saleDianDocumentSchema.nullable()
});

export const voidSaleResponseSchema = z.object({
  sale: saleSchema
});

export const dianEmissionRequestSchema = z.object({
  sale_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  idempotency_key: z.string().min(1),
  created_at: z.string().datetime()
});

export type SaleStatus = z.infer<typeof saleStatusSchema>;
export type DianStatus = z.infer<typeof dianStatusSchema>;
export type DianDocumentType = z.infer<typeof dianDocumentTypeSchema>;
export type SalePaymentMethod = z.infer<typeof salePaymentMethodSchema>;
export type SalePaymentMode = z.infer<typeof salePaymentModeSchema>;
export type SimpleSalePayment = z.infer<typeof simpleSalePaymentSchema>;
export type MixedSalePayment = z.infer<typeof mixedSalePaymentSchema>;
export type SalePayment = z.infer<typeof salePaymentSchema>;
export type CreateSaleItemInput = z.infer<typeof saleItemInputSchema>;
export type VoidSaleBody = z.infer<typeof voidSaleBodySchema>;
export type SaleTaxCategory = z.infer<typeof saleTaxCategorySchema>;
export type SaleTaxLine = z.infer<typeof saleTaxLineSchema>;
export type SalePaymentJson = z.infer<typeof salePaymentJsonSchema>;
export type Sale = z.infer<typeof saleSchema>;
export type SaleItem = z.infer<typeof saleItemSchema>;
export type CreatedSaleResponse = z.infer<typeof createdSaleResponseSchema>;
export type SalesListResponse = z.infer<typeof salesListResponseSchema>;
export type SaleDetailItem = z.infer<typeof saleDetailItemSchema>;
export type SaleDianDocument = z.infer<typeof saleDianDocumentSchema>;
export type SaleDetailResponse = z.infer<typeof saleDetailResponseSchema>;
export type VoidSaleResponse = z.infer<typeof voidSaleResponseSchema>;
export type DianEmissionRequest = z.infer<typeof dianEmissionRequestSchema>;

export type SaleStatusInput = z.infer<typeof saleStatusSchema>;
export type DianStatusInput = z.infer<typeof dianStatusSchema>;
export type DianDocumentTypeInput = z.infer<typeof dianDocumentTypeSchema>;
export type SalePaymentMethodInput = z.infer<typeof salePaymentMethodSchema>;
export type SalePaymentModeInput = z.infer<typeof salePaymentModeSchema>;
export type SimpleSalePaymentInput = z.infer<typeof simpleSalePaymentSchema>;
export type MixedSalePaymentInput = z.infer<typeof mixedSalePaymentSchema>;
export type SalePaymentInput = z.infer<typeof salePaymentSchema>;
export type SaleItemCreateInput = z.infer<typeof saleItemInputSchema>;
export type SaleItemInputInput = SaleItemCreateInput;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type VoidSaleBodyInput = z.infer<typeof voidSaleBodySchema>;
export type SaleTaxCategoryInput = z.infer<typeof saleTaxCategorySchema>;
export type SaleTaxLineInput = z.infer<typeof saleTaxLineSchema>;
export type SalePaymentJsonInput = z.infer<typeof salePaymentJsonSchema>;
export type SaleInput = z.infer<typeof saleSchema>;
export type SaleItemInput = z.infer<typeof saleItemSchema>;
export type CreatedSaleResponseInput = z.infer<typeof createdSaleResponseSchema>;
export type SalesListResponseInput = z.infer<typeof salesListResponseSchema>;
export type SaleDetailItemInput = z.infer<typeof saleDetailItemSchema>;
export type SaleDianDocumentInput = z.infer<typeof saleDianDocumentSchema>;
export type SaleDetailResponseInput = z.infer<typeof saleDetailResponseSchema>;
export type VoidSaleResponseInput = z.infer<typeof voidSaleResponseSchema>;
export type DianEmissionRequestInput = z.infer<typeof dianEmissionRequestSchema>;
