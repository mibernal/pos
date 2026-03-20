import { describe, expect, it } from 'vitest';
import {
  createSaleSchema,
  createdSaleResponseSchema,
  voidSaleBodySchema,
  voidSaleResponseSchema
} from '../src/schemas/sale.js';

describe('createSaleSchema', () => {
  it('accepts API DTO fields (snake_case and *_cents)', () => {
    const parsed = createSaleSchema.safeParse({
      client_uuid: '11111111-1111-4111-8111-111111111111',
      branch_id: '22222222-2222-4222-8222-222222222222',
      cash_session_id: '33333333-3333-4333-8333-333333333333',
      items: [
        {
          product_id: '44444444-4444-4444-8444-444444444444',
          qty: 1,
          price_cents: 10000
        }
      ],
      discount_cents: 500,
      payments: [{ method: 'CASH', amount_cents: 9500 }]
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.client_uuid).toBe('11111111-1111-4111-8111-111111111111');
      expect(parsed.data.discount_cents).toBe(500);
      expect(parsed.data.payments).toEqual([{ method: 'CASH', amount_cents: 9500 }]);
    }
  });

  it('rejects legacy camelCase payload keys', () => {
    const parsed = createSaleSchema.safeParse({
      branchId: '22222222-2222-4222-8222-222222222222',
      cashSessionId: '33333333-3333-4333-8333-333333333333',
      discountCents: 500,
      items: [
        {
          productId: '44444444-4444-4444-8444-444444444444',
          qty: 1,
          priceCents: 10000
        }
      ],
      payments: [{ method: 'CASH', amountCents: 9500 }]
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects unknown keys in sale payloads', () => {
    const parsed = createSaleSchema.safeParse({
      client_uuid: '11111111-1111-4111-8111-111111111111',
      branch_id: '22222222-2222-4222-8222-222222222222',
      cash_session_id: '33333333-3333-4333-8333-333333333333',
      items: [
        {
          product_id: '44444444-4444-4444-8444-444444444444',
          qty: 1,
          extra: 'nope'
        }
      ],
      discount_cents: 0,
      payments: [{ method: 'CASH', amount_cents: 10000 }]
    });

    expect(parsed.success).toBe(false);
  });

  it('validates created sale response includes persisted fiscal breakdown', () => {
    const parsed = createdSaleResponseSchema.safeParse({
      sale: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        branch_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        cash_session_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        sale_number: 15,
        status: 'COMPLETED',
        subtotal_cents: 11900,
        discount_cents: 0,
        total_cents: 11900,
        tax_total_cents: 1900,
        tax_lines_json: [
          {
            line_index: 0,
            category: 'IVA_19',
            base_cents: 10000,
            tax_cents: 1900,
            rate: 0.19
          }
        ],
        payment_json: {
          mode: 'CASH',
          total_cents: 11900,
          amounts: {
            cash_cents: 11900,
            card_cents: 0,
            transfer_cents: 0
          },
          payments: [{ method: 'CASH', amount_cents: 11900 }]
        },
        dian_status: 'PENDING',
        created_by_user_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        void_reason: null,
        voided_by_user_id: null,
        voided_at: null,
        created_at: '2026-03-06T12:00:00.000Z'
      },
      items: [
        {
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          product_id: '99999999-9999-4999-8999-999999999999',
          qty: 1,
          price_cents: 11900,
          line_total_cents: 11900
        }
      ]
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sale.tax_total_cents).toBe(1900);
      expect(parsed.data.sale.tax_lines_json).toHaveLength(1);
      expect(parsed.data.sale.tax_lines_json[0]).toMatchObject({
        category: 'IVA_19',
        base_cents: 10000,
        tax_cents: 1900,
        rate: 0.19
      });
    }
  });

  it('validates void sale payload and metadata in response', () => {
    const bodyParsed = voidSaleBodySchema.safeParse({
      void_reason: 'Cliente canceló el pedido'
    });

    const responseParsed = voidSaleResponseSchema.safeParse({
      sale: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        branch_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        cash_session_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        sale_number: 15,
        status: 'VOID',
        subtotal_cents: 11900,
        discount_cents: 0,
        total_cents: 11900,
        tax_total_cents: 1900,
        tax_lines_json: [],
        payment_json: {
          mode: 'CASH',
          total_cents: 11900,
          amounts: {
            cash_cents: 11900,
            card_cents: 0,
            transfer_cents: 0
          },
          payments: [{ method: 'CASH', amount_cents: 11900 }]
        },
        dian_status: 'ACCEPTED',
        created_by_user_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        void_reason: 'Cliente canceló el pedido',
        voided_by_user_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        voided_at: '2026-03-06T13:00:00.000Z',
        created_at: '2026-03-06T12:00:00.000Z'
      }
    });

    expect(bodyParsed.success).toBe(true);
    expect(responseParsed.success).toBe(true);
  });
});
