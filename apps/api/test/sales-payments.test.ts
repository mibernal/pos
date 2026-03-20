import { describe, expect, it } from 'vitest';
import { normalizeSalePayments } from '../src/modules/sales/payments.js';
import { computeTaxes } from '../src/domain/tax/index.js';

describe('sales payments normalization', () => {
  it('normalizes single CASH payment', () => {
    const result = normalizeSalePayments([{ method: 'CASH', amount_cents: 12000 }]);

    expect(result.mode).toBe('CASH');
    expect(result.total_amount_cents).toBe(12000);
    expect(result.amounts.cash_cents).toBe(12000);
    expect(result.amounts.card_cents).toBe(0);
    expect(result.amounts.transfer_cents).toBe(0);
  });

  it('normalizes multiple top-level payments as MIXED', () => {
    const result = normalizeSalePayments([
      { method: 'CASH', amount_cents: 4000 },
      { method: 'CARD', amount_cents: 6000 }
    ]);

    expect(result.mode).toBe('MIXED');
    expect(result.total_amount_cents).toBe(10000);
    expect(result.amounts.cash_cents).toBe(4000);
    expect(result.amounts.card_cents).toBe(6000);
    expect(result.amounts.transfer_cents).toBe(0);
  });

  it('supports explicit MIXED envelope', () => {
    const result = normalizeSalePayments([
      {
        method: 'MIXED',
        payments: [
          { method: 'CASH', amount_cents: 5000 },
          { method: 'TRANSFER', amount_cents: 3000 }
        ]
      }
    ]);

    expect(result.mode).toBe('MIXED');
    expect(result.total_amount_cents).toBe(8000);
    expect(result.amounts.cash_cents).toBe(5000);
    expect(result.amounts.transfer_cents).toBe(3000);
  });

  it('rejects MIXED envelope combined with other top-level methods', () => {
    expect(() =>
      normalizeSalePayments([
        { method: 'MIXED', payments: [{ method: 'CASH', amount_cents: 2000 }, { method: 'CARD', amount_cents: 3000 }] },
        { method: 'CASH', amount_cents: 1000 }
      ])
    ).toThrowError('Si envías método MIXED, debe ser el único elemento en payments');
  });

  it('keeps payment totals coherent with computed tax totals', () => {
    const taxResult = computeTaxes({
      taxMode: 'IVA',
      items: [
        { qty: 1, price_cents_final: 11900, tax_category: 'IVA_19' },
        { qty: 1, price_cents_final: 10000, tax_category: 'EXEMPT' }
      ],
      discount_cents_total: 1900
    });

    const normalizedPayments = normalizeSalePayments([
      { method: 'CASH', amount_cents: 10000 },
      { method: 'CARD', amount_cents: 10000 }
    ]);

    expect(taxResult.subtotal_cents).toBe(21900);
    expect(taxResult.total_cents).toBe(20000);
    expect(taxResult.tax_total_cents).toBe(1735);
    expect(normalizedPayments.total_amount_cents).toBe(taxResult.total_cents);
    expect(taxResult.tax_lines_json.reduce((sum, line) => sum + line.tax_cents, 0)).toBe(
      taxResult.tax_total_cents
    );
  });
});
