import { z } from 'zod';

export const productTaxCategorySchema = z.enum([
  'IVA_0',
  'IVA_5',
  'IVA_19',
  'EXEMPT',
  'EXCLUDED',
  'INC_8'
]);

export const productItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  branchId: z.string().uuid().nullable(),
  name: z.string().min(1),
  category: z.string().min(1),
  taxCategory: productTaxCategorySchema,
  barcode: z.string().min(1).nullable(),
  price_cents: z.number().int().nonnegative(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const createProductBodySchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(120),
  taxCategory: productTaxCategorySchema.optional().default('IVA_19'),
  barcode: z.string().trim().min(1).max(120).nullable().optional(),
  price_cents: z.coerce.number().int().nonnegative(),
  active: z.boolean().optional().default(true)
}).strict();

export const patchProductBodySchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  taxCategory: productTaxCategorySchema.optional(),
  barcode: z.string().trim().min(1).max(120).nullable().optional(),
  price_cents: z.coerce.number().int().nonnegative().optional()
}).strict();

export const productsListResponseSchema = z.object({
  items: z.array(productItemSchema),
  page: z.object({
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean()
  })
});

export const createProductResponseSchema = productItemSchema;
export const patchProductResponseSchema = productItemSchema;

export const createProductSchema = productItemSchema.omit({
  id: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true
});

export type ProductTaxCategory = z.infer<typeof productTaxCategorySchema>;
export type ProductItem = z.infer<typeof productItemSchema>;
export type CreateProductBody = z.input<typeof createProductBodySchema>;
export type PatchProductBody = z.input<typeof patchProductBodySchema>;
export type ProductsListResponse = z.infer<typeof productsListResponseSchema>;

export type ProductTaxCategoryInput = z.infer<typeof productTaxCategorySchema>;
export type ProductItemInput = z.infer<typeof productItemSchema>;
export type CreateProductBodyInput = z.input<typeof createProductBodySchema>;
export type PatchProductBodyInput = z.input<typeof patchProductBodySchema>;
export type ProductsListResponseInput = z.infer<typeof productsListResponseSchema>;
