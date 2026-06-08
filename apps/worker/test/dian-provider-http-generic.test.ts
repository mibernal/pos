import { afterEach, describe, expect, it, vi } from 'vitest';
import { DianProviderHttpGeneric } from '../src/providers/dian-provider-http-generic.js';

const validPayload = {
  sale_id: '22222222-2222-4222-a222-222222222222',
  tenant_id: '11111111-1111-4111-a111-111111111111',
  branch_id: '33333333-3333-4333-a333-333333333333',
  taxMode: 'INC_RESTAURANT' as const,
  idempotency_key: 'idem-1',
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
    sale_number: 12,
    created_at: new Date().toISOString(),
    subtotal_cents: 10000,
    discount_cents: 0,
    total_cents: 10000,
    tax_total_cents: 741,
    tax_lines: [
      {
        lineIndex: 0,
        category: 'INC_8' as const,
        base_cents: 10000,
        tax_cents: 800,
        rate: 0.08
      }
    ],
    payments: {
      mode: 'CASH' as const,
      total_cents: 10000,
      amounts: {
        cash_cents: 10000,
        card_cents: 0,
        transfer_cents: 0
      },
      payments: [{ method: 'CASH' as const, amount_cents: 10000 }]
    },
    items: [
      {
        id: 'item-1',
        product_id: 'product-1',
        product_name: 'Almuerzo Ejecutivo',
        barcode: null,
        tax_category: 'INC_8' as const,
        category: 'INC_8' as const,
        base_cents: 10000,
        tax_cents: 800,
        rate: 0.08,
        qty: 1,
        price_cents: 10000,
        line_total_cents: 10000
      }
    ]
  }
};

describe('DianProviderHttpGeneric', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps http response to provider result', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ACCEPTED',
          cude: 'CUDE-123'
        }),
        { status: 200 }
      )
    );

    const provider = new DianProviderHttpGeneric({
      url: 'https://example.com/dian',
      apiKey: 'secret',
      timeoutMs: 3000
    });

    const result = await provider.emitSale(validPayload);

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestOptions = fetchMock.mock.calls[0]![1];
    const serializedPayload =
      requestOptions && typeof requestOptions === 'object' && 'body' in requestOptions
        ? (requestOptions.body as string)
        : '';
    const parsedPayload = JSON.parse(serializedPayload);

    expect(parsedPayload.taxMode).toBe('INC_RESTAURANT');
    expect(parsedPayload.sale.tax_total_cents).toBe(741);
    expect(parsedPayload.sale.tax_lines).toEqual([
      {
        lineIndex: 0,
        category: 'INC_8',
        base_cents: 10000,
        tax_cents: 800,
        rate: 0.08
      }
    ]);
    expect(parsedPayload.sale.items[0]).toMatchObject({
      tax_category: 'INC_8',
      category: 'INC_8',
      base_cents: 10000,
      tax_cents: 800,
      rate: 0.08
    });
    expect(result.status).toBe('ACCEPTED');
    expect(result.cude).toBe('CUDE-123');
  });

  it('throws on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'bad request'
        }),
        { status: 400 }
      )
    );

    const provider = new DianProviderHttpGeneric({
      url: 'https://example.com/dian',
      timeoutMs: 3000
    });

    await expect(provider.emitSale(validPayload)).rejects.toThrowError(
      /DianProviderHttpGeneric error 400/
    );
  });

  it('preserves rejected status returned by the provider', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'REJECTED',
          cude: null
        }),
        { status: 200 }
      )
    );

    const provider = new DianProviderHttpGeneric({
      url: 'https://example.com/dian',
      timeoutMs: 3000
    });

    const result = await provider.emitSale(validPayload);

    expect(result.status).toBe('REJECTED');
    expect(result.cude).toBeNull();
  });

  it('throws when the provider omits the fiscal status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ cude: 'CUDE-123' }), { status: 200 })
    );

    const provider = new DianProviderHttpGeneric({
      url: 'https://example.com/dian',
      timeoutMs: 3000
    });

    await expect(provider.emitSale(validPayload)).rejects.toThrowError(
      /invalid provider status/
    );
  });

  it('throws when an accepted response has no CUDE', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ACCEPTED' }), { status: 200 })
    );

    const provider = new DianProviderHttpGeneric({
      url: 'https://example.com/dian',
      timeoutMs: 3000
    });

    await expect(provider.emitSale(validPayload)).rejects.toThrowError(
      /accepted response missing CUDE/
    );
  });
});
