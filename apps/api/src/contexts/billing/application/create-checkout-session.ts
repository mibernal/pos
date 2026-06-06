import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { WompiGateway } from '../domain/wompi-gateway.js';
import { MercadoPagoGateway } from '../domain/mercadopago-gateway.js';
import type { IPaymentGateway } from '../domain/payment-gateway.interface.js';

interface CreateCheckoutInput {
  tenantId: string;
  planId: string;
  gateway: 'WOMPI' | 'MERCADOPAGO' | 'MOCK';
  customerEmail: string;
  redirectUrl: string;
}

export async function createCheckoutSession(db: Kysely<Database>, input: CreateCheckoutInput) {
  // 1. Obtener detalles del plan
  const plan = await db
    .selectFrom('billing_plans')
    .select(['id', 'price_cents'])
    .where('id', '=', input.planId)
    .where('active', '=', true)
    .executeTakeFirst();

  if (!plan) {
    throw new AppError(404, 'NOT_FOUND', 'Plan no encontrado o inactivo');
  }

  const transactionId = randomUUID();
  const reference = `SUB_${input.tenantId}_${transactionId}`; // Reference única para el webhook

  let gatewayAdapter: IPaymentGateway;
  if (input.gateway === 'WOMPI') {
    gatewayAdapter = new WompiGateway();
  } else if (input.gateway === 'MERCADOPAGO') {
    gatewayAdapter = new MercadoPagoGateway();
  } else {
    // MOCK import
    const { MockGateway } = await import('../domain/mock-gateway.js');
    gatewayAdapter = new MockGateway();
  }

  // 2. Generar el checkout
  const { checkoutUrl, gatewayId } = await gatewayAdapter.createPaymentIntent({
    amountCents: plan.price_cents,
    reference,
    customerEmail: input.customerEmail,
    redirectUrl: input.redirectUrl
  });

  // 3. Registrar la transacción en BD (PENDING)
  await db
    .insertInto('payment_transactions')
    .values({
      id: transactionId,
      tenant_id: input.tenantId,
      amount_cents: plan.price_cents,
      currency: 'COP',
      gateway: input.gateway,
      gateway_transaction_id: gatewayId || null,
      gateway_reference: reference,
      status: 'PENDING',
      metadata_json: { planId: input.planId }
    })
    .execute();

  return { checkoutUrl, transactionId, reference };
}
