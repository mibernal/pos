import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import type {
  CreateSaleInput,
  DianEmissionRequest,
  Sale,
  SimpleSalePayment
} from '@pos-dian/shared';
import { createSaleSchema } from '@pos-dian/shared';
import { getNextSaleNumberFromCollection } from './sale-numbering-service.js';
import { computeTaxes, type TaxMode } from './tax/index.js';

interface CreateSaleInMemoryInput {
  tenant_id: string;
  created_by_user_id: string;
  tax_mode?: TaxMode;
  payload: CreateSaleInput;
}

const salesInMemory: Sale[] = [];

function normalizePayments(payments: CreateSaleInput['payments']): Sale['payment_json'] {
  const flattened: SimpleSalePayment[] = [];

  for (const payment of payments) {
    if (payment.method === 'MIXED') {
      flattened.push(...payment.payments);
      continue;
    }

    flattened.push(payment);
  }

  const amounts = {
    cash_cents: 0,
    card_cents: 0,
    transfer_cents: 0
  };

  for (const payment of flattened) {
    if (payment.method === 'CASH') {
      amounts.cash_cents += payment.amount_cents;
    } else if (payment.method === 'CARD') {
      amounts.card_cents += payment.amount_cents;
    } else {
      amounts.transfer_cents += payment.amount_cents;
    }
  }

  const mode: Sale['payment_json']['mode'] =
    payments.length === 1 && payments[0] && payments[0].method !== 'MIXED'
      ? payments[0].method
      : 'MIXED';

  return {
    mode,
    total_cents: amounts.cash_cents + amounts.card_cents + amounts.transfer_cents,
    amounts,
    payments: flattened
  };
}

export async function createSaleAndEnqueueEmission(
  input: CreateSaleInMemoryInput,
  queue: Queue<DianEmissionRequest>
): Promise<Sale> {
  const now = new Date().toISOString();
  const parsedPayload = createSaleSchema.parse(input.payload);

  const subtotal_cents = parsedPayload.items.reduce((sum, item) => {
    const priceCents = item.price_cents ?? 0;
    return sum + Math.round(item.qty * priceCents);
  }, 0);

  if (parsedPayload.discount_cents > subtotal_cents) {
    throw new Error('discount_cents no puede ser mayor que subtotal_cents');
  }

  const total_cents = subtotal_cents - parsedPayload.discount_cents;
  const computedTaxes = computeTaxes({
    taxMode: input.tax_mode ?? 'IVA',
    items: parsedPayload.items.map((item) => {
      const requestedTaxCategory = (
        item as {
          tax_category?: 'IVA_0' | 'IVA_5' | 'IVA_19' | 'EXEMPT' | 'EXCLUDED' | 'INC_8';
        }
      ).tax_category;

      return {
        qty: item.qty,
        price_cents_final: item.price_cents ?? 0,
        tax_category: requestedTaxCategory ?? 'IVA_19'
      };
    }),
    discount_cents_total: parsedPayload.discount_cents
  });

  if (
    computedTaxes.subtotal_cents !== subtotal_cents ||
    computedTaxes.discount_cents !== parsedPayload.discount_cents ||
    computedTaxes.total_cents !== total_cents
  ) {
    throw new Error('Inconsistencia al calcular impuestos para la venta');
  }

  const sale: Sale = {
    id: randomUUID(),
    tenant_id: input.tenant_id,
    branch_id: parsedPayload.branch_id,
    cash_session_id: parsedPayload.cash_session_id,
    sale_number: getNextSaleNumberFromCollection(salesInMemory, {
      tenantId: input.tenant_id,
      branchId: parsedPayload.branch_id
    }),
    status: 'COMPLETED',
    subtotal_cents,
    discount_cents: parsedPayload.discount_cents,
    total_cents,
    tax_total_cents: computedTaxes.tax_total_cents,
    tax_lines_json: computedTaxes.tax_lines_json,
    payment_json: normalizePayments(parsedPayload.payments),
    dian_status: 'PENDING',
    created_by_user_id: input.created_by_user_id,
    void_reason: null,
    voided_by_user_id: null,
    voided_at: null,
    created_at: now
  };

  salesInMemory.push(sale);

  await queue.add(
    'emit-sale-dian',
    {
      sale_id: sale.id,
      tenant_id: sale.tenant_id,
      branch_id: sale.branch_id,
      idempotency_key: parsedPayload.client_uuid,
      created_at: now
    },
    {
      jobId: `dian:${sale.tenant_id}:${parsedPayload.client_uuid}`
    }
  );

  return sale;
}

export function getSalesHistory(tenantId: string, branchId: string): Sale[] {
  return salesInMemory.filter((sale) => sale.tenant_id === tenantId && sale.branch_id === branchId);
}
