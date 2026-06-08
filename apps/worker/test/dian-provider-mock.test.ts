import { describe, expect, it } from 'vitest';
import { DianProviderMock } from '../src/providers/dian-provider-mock.js';

describe('DianProviderMock', () => {
  it('returns accepted status and cude', async () => {
    const provider = new DianProviderMock();
    const response = await provider.emitSale({
      sale_id: '22222222-2222-4222-a222-222222222222',
      tenant_id: '11111111-1111-4111-a111-111111111111',
      branch_id: '33333333-3333-4333-a333-333333333333',
      taxMode: 'IVA',
      idempotency_key: 'idempotency-key-1',
      tenant: {
        id: '11111111-1111-4111-a111-111111111111',
        nit: '900123123',
        name: 'Tenant Demo',
        business_name: 'Comercio Demo SAS'
      },
      branch: {
        id: '33333333-3333-4333-a333-333333333333',
        name: 'Sucursal Centro',
        address: 'Calle 1 # 2-3'
      },
      sale: {
        id: '22222222-2222-4222-a222-222222222222',
        sale_number: 10,
        created_at: new Date().toISOString(),
        subtotal_cents: 10000,
        discount_cents: 0,
        total_cents: 10000,
        tax_total_cents: 1597,
        tax_lines: [
          {
            lineIndex: 0,
            category: 'IVA_19',
            base_cents: 8403,
            tax_cents: 1597,
            rate: 0.19
          }
        ],
        payments: {
          mode: 'CASH',
          total_cents: 10000,
          amounts: {
            cash_cents: 10000,
            card_cents: 0,
            transfer_cents: 0
          },
          payments: [{ method: 'CASH', amount_cents: 10000 }]
        },
        items: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            product_id: '55555555-5555-4555-8555-555555555555',
            product_name: 'Producto Demo',
            barcode: null,
            tax_category: 'IVA_19',
            category: 'IVA_19',
            base_cents: 8403,
            tax_cents: 1597,
            rate: 0.19,
            qty: 1,
            price_cents: 10000,
            line_total_cents: 10000
          }
        ]
      }
    });

    expect(response.status).toBe('ACCEPTED');
    expect(response.cude).toContain('CUDE-');
    expect(response.raw.taxMode).toBe('IVA');
    expect(response.raw.tax_total_cents).toBe(1597);
    expect(response.raw.tax_lines).toEqual([
      {
        lineIndex: 0,
        category: 'IVA_19',
        base_cents: 8403,
        tax_cents: 1597,
        rate: 0.19
      }
    ]);
    expect(response.raw.itemTaxes).toEqual([
      {
        product_id: '55555555-5555-4555-8555-555555555555',
        tax_category: 'IVA_19',
        category: 'IVA_19',
        base_cents: 8403,
        tax_cents: 1597,
        rate: 0.19
      }
    ]);
  });
});
