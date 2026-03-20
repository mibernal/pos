import { describe, expect, it } from 'vitest';
import { createProductBodySchema, patchProductBodySchema } from '../src/schemas/product.js';

describe('product schemas', () => {
  it('accepts valid create payloads and defaults taxCategory', () => {
    const parsed = createProductBodySchema.safeParse({
      name: 'Carne molida',
      category: 'Carnes',
      price_cents: 25900
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.taxCategory).toBe('IVA_19');
    }
  });

  it('rejects unknown keys in product payloads', () => {
    const parsed = patchProductBodySchema.safeParse({
      name: 'Carne molida premium',
      unexpected: true
    });

    expect(parsed.success).toBe(false);
  });
});
