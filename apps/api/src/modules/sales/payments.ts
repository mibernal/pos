import type { MixedPaymentInput, SalePaymentInput, SimplePaymentInput } from './schemas.js';

export interface NormalizedPayment {
  method: 'CASH' | 'CARD' | 'TRANSFER';
  amount_cents: number;
}

export interface NormalizedPaymentsResult {
  mode: 'CASH' | 'CARD' | 'TRANSFER' | 'MIXED';
  payments: NormalizedPayment[];
  total_amount_cents: number;
  amounts: {
    cash_cents: number;
    card_cents: number;
    transfer_cents: number;
  };
}

function flattenPayments(inputPayments: ReadonlyArray<SalePaymentInput>): ReadonlyArray<SimplePaymentInput> {
  const flattened: SimplePaymentInput[] = [];
  for (const payment of inputPayments) {
    if (payment.method === 'MIXED') {
      const mixedPayment = payment as MixedPaymentInput;
      flattened.push(...mixedPayment.payments);
      continue;
    }

    flattened.push(payment as SimplePaymentInput);
  }

  return flattened;
}

export function normalizeSalePayments(
  inputPayments: ReadonlyArray<SalePaymentInput>
): NormalizedPaymentsResult {
  const hasMixedEnvelope = inputPayments.some((payment) => payment.method === 'MIXED');

  if (hasMixedEnvelope && inputPayments.length > 1) {
    throw new Error('Si envías método MIXED, debe ser el único elemento en payments');
  }

  const flattenedPayments = flattenPayments(inputPayments);
  if (flattenedPayments.length === 0) {
    throw new Error('Debe existir al menos un pago');
  }

  const totals = {
    cash_cents: 0,
    card_cents: 0,
    transfer_cents: 0
  };

  const normalizedPayments: NormalizedPayment[] = flattenedPayments.map((payment) => {
    if (payment.method === 'CASH') {
      totals.cash_cents += payment.amount_cents;
    } else if (payment.method === 'CARD') {
      totals.card_cents += payment.amount_cents;
    } else {
      totals.transfer_cents += payment.amount_cents;
    }

    return {
      method: payment.method,
      amount_cents: payment.amount_cents
    };
  });

  const totalAmountCents = normalizedPayments.reduce((acc, payment) => acc + payment.amount_cents, 0);

  const mode =
    hasMixedEnvelope || normalizedPayments.length > 1 ? 'MIXED' : normalizedPayments[0]!.method;

  return {
    mode,
    payments: normalizedPayments,
    total_amount_cents: totalAmountCents,
    amounts: totals
  };
}
