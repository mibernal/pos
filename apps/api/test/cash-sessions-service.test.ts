import { describe, expect, it } from 'vitest';
import {
  calculateDiffCents,
  calculateExpectedCashCents,
  extractCashPaidCents
} from '../src/contexts/sales/domain/cash-sessions-service.js';

describe('cash sessions service', () => {
  it('uses sale total for cash payment method when no explicit amount exists', () => {
    expect(extractCashPaidCents({ paymentMethod: 'cash' }, 15000)).toBe(15000);
  });

  it('returns zero for non-cash payment method', () => {
    expect(extractCashPaidCents({ paymentMethod: 'card' }, 15000)).toBe(0);
  });

  it('uses explicit cash amount for mixed payment', () => {
    expect(extractCashPaidCents({ paymentMethod: 'mixed', cash_cents: 7000 }, 15000)).toBe(7000);
  });

  it('reads nested cash amount values', () => {
    expect(
      extractCashPaidCents(
        {
          method: 'mixed',
          amounts: { cash_amount_cents: '4500' }
        },
        15000
      )
    ).toBe(4500);
  });

  it('calculates expected cash as opening + collected cash', () => {
    const expected = calculateExpectedCashCents(20000, [
      { payment_json: { paymentMethod: 'cash' }, total_cents: 15000 },
      { payment_json: { paymentMethod: 'transfer' }, total_cents: 9000 },
      { payment_json: { paymentMethod: 'mixed', breakdown: { cash_cents: 2500 } }, total_cents: 10000 }
    ]);

    expect(expected).toBe(37500);
  });

  it('calculates diff cents as real minus expected', () => {
    expect(calculateDiffCents(37500, 36000)).toBe(-1500);
  });
});
