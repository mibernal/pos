export type TaxMode = 'IVA' | 'INC_RESTAURANT';
export type TaxCategory = 'IVA_0' | 'IVA_5' | 'IVA_19' | 'EXEMPT' | 'EXCLUDED' | 'INC_8';

export interface ComputeTaxesLineInput {
  qty: number;
  price_cents_final: number;
  tax_category: TaxCategory;
}

export interface ComputeTaxesInput {
  taxMode: TaxMode;
  items: ReadonlyArray<ComputeTaxesLineInput>;
  discount_cents_total: number;
}

export interface TaxLine {
  line_index: number;
  category: TaxCategory | 'INC';
  base_cents: number;
  tax_cents: number;
  rate: number;
}

export interface ComputeTaxesResult {
  subtotal_cents: number;
  discount_cents: number;
  tax_total_cents: number;
  total_cents: number;
  tax_lines_json: TaxLine[];
}

const INC_RESTAURANT_RATE = 0.08;

function assertInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} debe ser entero`);
  }
}

function assertNonNegativeInteger(value: number, fieldName: string): void {
  assertInteger(value, fieldName);
  if (value < 0) {
    throw new Error(`${fieldName} debe ser >= 0`);
  }
}

function assertPositiveNumber(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} debe ser > 0`);
  }
}

function calculateLineTotalCents(item: ComputeTaxesLineInput, lineIndex: number): number {
  assertPositiveNumber(item.qty, `items[${lineIndex}].qty`);
  assertNonNegativeInteger(item.price_cents_final, `items[${lineIndex}].price_cents_final`);
  return Math.round(item.qty * item.price_cents_final);
}

function allocateDiscountsProportionally(
  lineTotalsCents: ReadonlyArray<number>,
  discountCents: number
): number[] {
  if (discountCents === 0) {
    return lineTotalsCents.map(() => 0);
  }

  const subtotalCents = lineTotalsCents.reduce((sum, lineTotalCents) => sum + lineTotalCents, 0);
  if (subtotalCents <= 0) {
    throw new Error('No se puede distribuir descuento cuando subtotal_cents es 0');
  }

  const discounts = lineTotalsCents.map(() => 0);
  const remainders = lineTotalsCents.map((lineTotalCents, lineIndex) => {
    const multiplied = lineTotalCents * discountCents;
    const floorShare = Math.floor(multiplied / subtotalCents);
    discounts[lineIndex] = floorShare;

    return {
      lineIndex,
      remainder: multiplied - floorShare * subtotalCents
    };
  });

  const allocatedCents = discounts.reduce((sum, current) => sum + current, 0);
  let pendingCents = discountCents - allocatedCents;

  remainders.sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder - a.remainder;
    }

    return a.lineIndex - b.lineIndex;
  });

  let cursor = 0;
  while (pendingCents > 0 && remainders.length > 0) {
    const currentRemainder = remainders[cursor];
    if (!currentRemainder) {
      break;
    }

    const currentDiscount = discounts[currentRemainder.lineIndex];
    discounts[currentRemainder.lineIndex] = (currentDiscount ?? 0) + 1;
    pendingCents -= 1;
    cursor = (cursor + 1) % remainders.length;
  }

  return discounts;
}

function resolveIvaRate(category: TaxCategory): number {
  if (category === 'IVA_5') {
    return 0.05;
  }

  if (category === 'IVA_19') {
    return 0.19;
  }

  return 0;
}

function computeInclusiveTaxAmounts(lineTotalAfterDiscountCents: number, rate: number): {
  base_cents: number;
  tax_cents: number;
} {
  if (rate <= 0) {
    return {
      base_cents: lineTotalAfterDiscountCents,
      tax_cents: 0
    };
  }

  const baseCents = Math.round(lineTotalAfterDiscountCents / (1 + rate));
  return {
    base_cents: baseCents,
    tax_cents: lineTotalAfterDiscountCents - baseCents
  };
}

function computeLineTax(
  taxMode: TaxMode,
  taxCategory: TaxCategory,
  lineTotalAfterDiscountCents: number,
  lineIndex: number
): TaxLine {
  if (taxMode === 'INC_RESTAURANT') {
    const amounts = computeInclusiveTaxAmounts(lineTotalAfterDiscountCents, INC_RESTAURANT_RATE);
    return {
      line_index: lineIndex,
      category: 'INC',
      base_cents: amounts.base_cents,
      tax_cents: amounts.tax_cents,
      rate: INC_RESTAURANT_RATE
    };
  }

  const ivaRate = resolveIvaRate(taxCategory);
  const amounts = computeInclusiveTaxAmounts(lineTotalAfterDiscountCents, ivaRate);

  return {
    line_index: lineIndex,
    category: taxCategory,
    base_cents: amounts.base_cents,
    tax_cents: amounts.tax_cents,
    rate: ivaRate
  };
}

// Estrategia elegida: el descuento total se distribuye proporcionalmente por línea (sobre precio final)
// antes del cálculo del impuesto, para que total y tax_lines_json sean consistentes por centavo.
export function computeTaxes(input: ComputeTaxesInput): ComputeTaxesResult {
  assertNonNegativeInteger(input.discount_cents_total, 'discount_cents_total');

  const lineTotalsCents = input.items.map((item, lineIndex) => calculateLineTotalCents(item, lineIndex));
  const subtotalCents = lineTotalsCents.reduce((sum, lineTotalCents) => sum + lineTotalCents, 0);

  if (input.discount_cents_total > subtotalCents) {
    throw new Error('discount_cents_total no puede ser mayor que subtotal_cents');
  }

  const lineDiscountsCents = allocateDiscountsProportionally(lineTotalsCents, input.discount_cents_total);
  const taxLines: TaxLine[] = [];

  for (let lineIndex = 0; lineIndex < input.items.length; lineIndex += 1) {
    const item = input.items[lineIndex];
    const lineTotalCents = lineTotalsCents[lineIndex];
    const lineDiscountCents = lineDiscountsCents[lineIndex];

    if (!item || lineTotalCents === undefined || lineDiscountCents === undefined) {
      throw new Error('No se pudo calcular impuestos para una línea');
    }

    taxLines.push(
      computeLineTax(input.taxMode, item.tax_category, lineTotalCents - lineDiscountCents, lineIndex)
    );
  }

  const taxTotalCents = taxLines.reduce((sum, line) => sum + line.tax_cents, 0);
  const totalCents = subtotalCents - input.discount_cents_total;

  return {
    subtotal_cents: subtotalCents,
    discount_cents: input.discount_cents_total,
    tax_total_cents: taxTotalCents,
    total_cents: totalCents,
    tax_lines_json: taxLines
  };
}
