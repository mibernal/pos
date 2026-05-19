interface PaymentSnapshot {
  payment_json: unknown;
  total_cents: number;
}

interface CashMovementSnapshot {
  type: 'IN' | 'OUT';
  amount_cents: number;
}

type JsonRecord = Record<string, unknown>;

const CASH_AMOUNT_PATHS: ReadonlyArray<ReadonlyArray<string>> = [
  ['cash_cents'],
  ['cash_amount_cents'],
  ['cashAmountCents'],
  ['cash', 'cents'],
  ['cash', 'amount_cents'],
  ['cash', 'amountCents'],
  ['amounts', 'cash_cents'],
  ['amounts', 'cash_amount_cents'],
  ['amounts', 'cashAmountCents'],
  ['breakdown', 'cash_cents'],
  ['breakdown', 'cash_amount_cents'],
  ['breakdown', 'cashAmountCents'],
  ['payment', 'cash_cents'],
  ['payment', 'cash_amount_cents'],
  ['payment', 'cashAmountCents']
];

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNonNegativeInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.trunc(parsed);
    }
  }

  return null;
}

function getAtPath(record: JsonRecord, path: ReadonlyArray<string>): unknown {
  let current: unknown = record;
  for (const segment of path) {
    if (!isJsonRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function getPaymentMethod(paymentJson: unknown): string | undefined {
  if (!isJsonRecord(paymentJson)) {
    return undefined;
  }

  const method = paymentJson.payment_method ?? paymentJson.paymentMethod ?? paymentJson.method;
  if (typeof method !== 'string') {
    return undefined;
  }

  return method.toLowerCase();
}

function readExplicitCashAmountCents(paymentJson: unknown): number | null {
  if (!isJsonRecord(paymentJson)) {
    return null;
  }

  for (const path of CASH_AMOUNT_PATHS) {
    const rawValue = getAtPath(paymentJson, path);
    const parsed = toNonNegativeInteger(rawValue);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function extractCashPaidCents(paymentJson: unknown, totalCents: number): number {
  const explicitCashAmountCents = readExplicitCashAmountCents(paymentJson);
  if (explicitCashAmountCents !== null) {
    return explicitCashAmountCents;
  }

  const paymentMethod = getPaymentMethod(paymentJson);
  if (paymentMethod === 'cash') {
    return totalCents;
  }

  return 0;
}

export function calculateExpectedCashCents(
  openingAmountCents: number,
  salePayments: ReadonlyArray<PaymentSnapshot>,
  cashMovements: ReadonlyArray<CashMovementSnapshot> = []
): number {
  let expectedCashCents = openingAmountCents;

  for (const salePayment of salePayments) {
    expectedCashCents += extractCashPaidCents(salePayment.payment_json, salePayment.total_cents);
  }

  for (const movement of cashMovements) {
    if (movement.type === 'IN') {
      expectedCashCents += movement.amount_cents;
    } else {
      expectedCashCents -= movement.amount_cents;
    }
  }

  return expectedCashCents;
}

export function calculateDiffCents(expectedCashCents: number, closingCashRealCents: number): number {
  return closingCashRealCents - expectedCashCents;
}
