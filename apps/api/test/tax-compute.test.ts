import { describe, expect, it } from 'vitest';
import { computeTaxes } from '../src/shared/domain/tax/index.js';

describe('tax compute service', () => {
  it('computes IVA 19 included in final price', () => {
    const result = computeTaxes({
      taxMode: 'IVA',
      items: [{ qty: 1, price_cents_final: 11900, tax_category: 'IVA_19' }],
      discount_cents_total: 0
    });

    expect(result).toEqual({
      subtotal_cents: 11900,
      discount_cents: 0,
        tip_cents: 0,
      tax_total_cents: 1900,
      total_cents: 11900,
      tax_lines_json: [
        {
          line_index: 0,
          category: 'IVA_19',
          base_cents: 10000,
          tax_cents: 1900,
          rate: 0.19
        }
      ]
    });
  });

  it('computes IVA 5 included in final price', () => {
    const result = computeTaxes({
      taxMode: 'IVA',
      items: [{ qty: 1, price_cents_final: 10500, tax_category: 'IVA_5' }],
      discount_cents_total: 0
    });

    expect(result).toEqual({
      subtotal_cents: 10500,
      discount_cents: 0,
        tip_cents: 0,
      tax_total_cents: 500,
      total_cents: 10500,
      tax_lines_json: [
        {
          line_index: 0,
          category: 'IVA_5',
          base_cents: 10000,
          tax_cents: 500,
          rate: 0.05
        }
      ]
    });
  });

  it('keeps tax in zero for exempt and excluded categories', () => {
    const result = computeTaxes({
      taxMode: 'IVA',
      items: [
        { qty: 1, price_cents_final: 10000, tax_category: 'EXEMPT' },
        { qty: 1, price_cents_final: 5000, tax_category: 'EXCLUDED' }
      ],
      discount_cents_total: 0
    });

    expect(result).toEqual({
      subtotal_cents: 15000,
      discount_cents: 0,
        tip_cents: 0,
      tax_total_cents: 0,
      total_cents: 15000,
      tax_lines_json: [
        {
          line_index: 0,
          category: 'EXEMPT',
          base_cents: 10000,
          tax_cents: 0,
          rate: 0
        },
        {
          line_index: 1,
          category: 'EXCLUDED',
          base_cents: 5000,
          tax_cents: 0,
          rate: 0
        }
      ]
    });
  });

  it('computes INC 8 in INC_RESTAURANT mode', () => {
    const result = computeTaxes({
      taxMode: 'INC_RESTAURANT',
      items: [{ qty: 1, price_cents_final: 10800, tax_category: 'INC_8' }],
      discount_cents_total: 0
    });

    expect(result).toEqual({
      subtotal_cents: 10800,
      discount_cents: 0,
        tip_cents: 0,
      tax_total_cents: 800,
      total_cents: 10800,
      tax_lines_json: [
        {
          line_index: 0,
          category: 'INC',
          base_cents: 10000,
          tax_cents: 800,
          rate: 0.08
        }
      ]
    });
  });

  it('applies total discount proportionally before tax calculation', () => {
    const result = computeTaxes({
      taxMode: 'IVA',
      items: [
        { qty: 1, price_cents_final: 11900, tax_category: 'IVA_19' },
        { qty: 1, price_cents_final: 10500, tax_category: 'IVA_5' }
      ],
      discount_cents_total: 2400
    });

    expect(result).toEqual({
      subtotal_cents: 22400,
      discount_cents: 2400,
        tip_cents: 0,
      tax_total_cents: 2142,
      total_cents: 20000,
      tax_lines_json: [
        {
          line_index: 0,
          category: 'IVA_19',
          base_cents: 8929,
          tax_cents: 1696,
          rate: 0.19
        },
        {
          line_index: 1,
          category: 'IVA_5',
          base_cents: 8929,
          tax_cents: 446,
          rate: 0.05
        }
      ]
    });
  });
});
