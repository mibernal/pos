import { z } from 'zod';
import { createProductBodySchema, patchProductBodySchema } from '@pos-dian/shared';

export { createProductBodySchema, patchProductBodySchema };

export const branchHeaderSchema = z.object({
  'x-branch-id': z.string().uuid().optional()
});

const optionalSearchQuerySchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  },
  z.string().max(120).optional()
);

export const productsQuerySchema = z.object({
  query: optionalSearchQuerySchema,
  limit: z.coerce.number().int().positive().max(100).default(20)
});

export const patchProductParamsSchema = z.object({
  id: z.string().uuid()
});

export type BranchHeaders = z.infer<typeof branchHeaderSchema>;
export type ProductsQueryInput = z.infer<typeof productsQuerySchema>;
export type CreateProductInput = z.infer<typeof createProductBodySchema>;
export type PatchProductInput = z.infer<typeof patchProductBodySchema>;
