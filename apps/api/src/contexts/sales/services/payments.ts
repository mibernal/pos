import {
  PAYMENT_KIND_BEHAVIOR,
  summarizePayments,
  type PaymentKind,
  type ShiftPaymentSummary
} from '@pos-dian/shared';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import type { MixedPaymentInput, SalePaymentInput, SimplePaymentInput } from './schemas.js';

/**
 * Normalización de los pagos de una venta.
 *
 * Antes esto conocía tres métodos y devolvía un objeto con `cash_cents`, `card_cents` y
 * `transfer_cents`. Cualquier medio distinto no tenía dónde caer, y por eso el resto del
 * sistema —arqueo, Z, informe de ingresos— los descartaba en silencio.
 *
 * Sigue siendo una función pura: el catálogo del comercio se le pasa ya resuelto. Eso la
 * mantiene comprobable sin base de datos y evita que la validación de un cobro dependa de
 * una consulta escondida a mitad del cálculo.
 */

export interface CatalogEntry {
  code: string;
  kind: PaymentKind;
  label: string;
  active: boolean;
  requires_reference: boolean;
}

export interface NormalizedPayment {
  method: PaymentKind;
  method_code: string;
  label: string;
  amount_cents: number;
  /** Solo en efectivo: lo que entregó el cliente y el vuelto que salió del cajón. */
  tendered_cents?: number;
  change_cents?: number;
  reference?: string;
  /** Se conserva para no cambiar la forma del `payment_json` que ya se guardaba. */
  approval_code?: string;
}

export interface NormalizedPaymentsResult {
  mode: string;
  payments: NormalizedPayment[];
  total_amount_cents: number;
  /** Agrupación por comportamiento del dinero: cajón, electrónico, sin entrada. */
  summary: ShiftPaymentSummary;
  /** Forma antigua, conservada dentro de `payment_json` para no romper lo ya escrito. */
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
      const mixedPayment = payment as unknown as MixedPaymentInput;
      flattened.push(...mixedPayment.payments);
      continue;
    }

    flattened.push(payment as SimplePaymentInput);
  }

  return flattened;
}

/**
 * Resuelve la entrada del catálogo de un pago.
 *
 * Sin catálogo —las pruebas unitarias, y una venta que llega de la cola offline antes de
 * que el comercio configure nada— se usa la entrada homónima del tipo con el comportamiento
 * por defecto. Es lo que hace que una venta con `method: 'CASH'` y nada más siga siendo
 * válida exactamente como antes.
 */
function resolveEntry(
  payment: SimplePaymentInput,
  catalog: ReadonlyMap<string, CatalogEntry> | undefined
): CatalogEntry {
  const behavior = PAYMENT_KIND_BEHAVIOR[payment.method];
  const code = (payment.method_code ?? payment.method).toUpperCase();

  if (!catalog) {
    return { code, kind: payment.method, label: behavior.label, active: true, requires_reference: behavior.requiresReference };
  }

  const entry = catalog.get(code);

  if (!entry) {
    throw new AppError(400, 'PAYMENT_METHOD_UNKNOWN', `El medio de pago ${code} no existe en este comercio`, {
      method_code: code
    });
  }

  if (!entry.active) {
    throw new AppError(400, 'PAYMENT_METHOD_INACTIVE', `El medio de pago ${entry.label} no está habilitado`, {
      method_code: code
    });
  }

  // El tipo lo manda el catálogo, no el cliente: si no, bastaría con enviar
  // `method: 'CASH'` sobre el código de un bono para meter en el arqueo dinero que no entró.
  if (entry.kind !== payment.method) {
    throw new AppError(
      400,
      'PAYMENT_METHOD_KIND_MISMATCH',
      `El medio ${entry.label} es de tipo ${entry.kind}, no ${payment.method}`,
      { method_code: code, expected: entry.kind, received: payment.method }
    );
  }

  return entry;
}

export function normalizeSalePayments(
  inputPayments: ReadonlyArray<SalePaymentInput>,
  catalog?: ReadonlyMap<string, CatalogEntry>
): NormalizedPaymentsResult {
  const hasMixedEnvelope = inputPayments.some((payment) => payment.method === ('MIXED' as PaymentKind));

  if (hasMixedEnvelope && inputPayments.length > 1) {
    throw new AppError(400, 'PAYMENTS_INVALID', 'Si envías método MIXED, debe ser el único elemento en payments');
  }

  const flattenedPayments = flattenPayments(inputPayments);
  if (flattenedPayments.length === 0) {
    throw new AppError(400, 'PAYMENTS_INVALID', 'Debe existir al menos un pago');
  }

  const normalizedPayments: NormalizedPayment[] = flattenedPayments.map((payment) => {
    const entry = resolveEntry(payment, catalog);
    const reference = payment.reference ?? payment.approval_code;

    if (payment.method === 'CARD' && !payment.approval_code && !payment.reference) {
      throw new AppError(
        400,
        'PAYMENT_APPROVAL_REQUIRED',
        'El código de aprobación del terminal es obligatorio para pagos con tarjeta'
      );
    }

    if (entry.requires_reference && !reference) {
      throw new AppError(
        400,
        'PAYMENT_REFERENCE_REQUIRED',
        `El medio de pago ${entry.label} exige una referencia`,
        { method_code: entry.code }
      );
    }

    /**
     * El vuelto se calcula, no se recibe. Aceptarlo del cliente permitiría declarar un
     * cambio distinto de la resta y descuadrar el cajón con una venta perfectamente válida;
     * el CHECK de la tabla rechaza esa combinación, y aquí ni siquiera se puede construir.
     */
    const tendered = payment.method === 'CASH' ? payment.tendered_cents : undefined;
    const change = tendered !== undefined ? tendered - payment.amount_cents : undefined;

    return {
      method: payment.method,
      method_code: entry.code,
      label: entry.label,
      amount_cents: payment.amount_cents,
      ...(tendered !== undefined ? { tendered_cents: tendered, change_cents: change } : {}),
      ...(reference ? { reference } : {}),
      ...(payment.approval_code ? { approval_code: payment.approval_code } : {})
    };
  });

  const totalAmountCents = normalizedPayments.reduce((acc, payment) => acc + payment.amount_cents, 0);

  const summary = summarizePayments(
    normalizedPayments.map((payment) => ({
      method_code: payment.method_code,
      kind: payment.method,
      label: payment.label,
      amount_cents: payment.amount_cents,
      tendered_cents: payment.tendered_cents ?? null,
      change_cents: payment.change_cents ?? null
    }))
  );

  const mode = hasMixedEnvelope || normalizedPayments.length > 1 ? 'MIXED' : normalizedPayments[0]!.method;

  const amounts = { cash_cents: 0, card_cents: 0, transfer_cents: 0 };
  for (const payment of normalizedPayments) {
    if (payment.method === 'CASH') amounts.cash_cents += payment.amount_cents;
    else if (payment.method === 'CARD') amounts.card_cents += payment.amount_cents;
    else if (payment.method === 'TRANSFER') amounts.transfer_cents += payment.amount_cents;
  }

  return {
    mode,
    payments: normalizedPayments,
    total_amount_cents: totalAmountCents,
    summary,
    amounts
  };
}
