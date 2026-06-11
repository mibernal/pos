import type { Kysely } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { WompiGateway } from '../domain/wompi-gateway.js';
import { MercadoPagoGateway } from '../domain/mercadopago-gateway.js';
import { StripeGateway } from '../domain/stripe-gateway.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';
import { SubscriptionService } from './subscription.service.js';

interface WebhookInput {
  gateway: 'WOMPI' | 'MERCADOPAGO' | 'STRIPE';
  headers: Record<string, string>;
  rawBody: string;
}

export async function processPaymentWebhook(db: Kysely<Database>, input: WebhookInput) {
  const adapter = input.gateway === 'WOMPI' ? new WompiGateway() : input.gateway === 'STRIPE' ? new StripeGateway() : new MercadoPagoGateway();

  // 1. Validar firma criptográfica
  const isValid = adapter.verifyWebhookSignature(input.headers, input.rawBody);
  if (!isValid) {
    throw new AppError(400, 'BAD_REQUEST', 'Firma de webhook inválida');
  }

  const payload = JSON.parse(input.rawBody);
  const result = await adapter.parseWebhook(payload);

  if (!result.reference) {
    // Algunas pasarelas envían eventos generales sin referencia. Se ignoran en este MVP prepago.
    return { success: true, ignored: true };
  }

  // 2. Buscar transacción
  const tx = await db
    .selectFrom('payment_transactions')
    .select(['id', 'tenant_id', 'status', 'metadata_json'])
    .where('gateway_reference', '=', result.reference)
    .executeTakeFirst();

  if (!tx) {
    // Transacción no es nuestra, ignoramos
    return { success: true, ignored: true };
  }

  if (tx.status === 'APPROVED') {
    // Ya fue procesada antes (idempotencia)
    return { success: true, alreadyProcessed: true };
  }

  // 3. Actualizar transacción
  const newStatus = result.status;
  const updateResult = await db
    .updateTable('payment_transactions')
    .set({
      status: newStatus,
      gateway_transaction_id: result.gatewayTransactionId || null,
      updated_at: new Date()
    })
    .where('id', '=', tx.id)
    .where('status', '!=', 'APPROVED')
    .executeTakeFirst();

  if (Number(updateResult.numUpdatedRows) === 0) {
    // Si numUpdatedRows es 0, significa que otro hilo o proceso
    // ya aprobó la transacción de manera concurrente.
    return { success: true, alreadyProcessed: true };
  }

  // 4. Actualizar el plan si fue Aprobado
  if (newStatus === 'APPROVED') {
    const meta = tx.metadata_json as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const planId = meta?.planId;

    if (planId) {
      await db.transaction().execute(async (trx) => {
        const sub = await trx.selectFrom('tenant_subscriptions').select(['plan_id', 'status']).where('tenant_id', '=', tx.tenant_id).executeTakeFirst();
        
        await trx
          .updateTable('tenants')
          .set({ status: 'ACTIVE' })
          .where('id', '=', tx.tenant_id)
          .execute();

        if (sub?.plan_id !== planId) {
          await SubscriptionService.upgradeSubscription(trx, tx.tenant_id, planId);
        }

        if (sub?.status === 'ACTIVE') {
          await SubscriptionService.renewSubscription(trx, tx.tenant_id, 30);
        } else {
          await SubscriptionService.activateSubscription(trx, tx.tenant_id, 30);
        }

        await writeAuditLog(trx, {
          tenantId: tx.tenant_id,
          entityType: 'TENANT',
          entityId: tx.tenant_id,
          action: 'TENANT_SUBSCRIPTION_PROCESSED',
          payloadJson: { previous: { plan: sub?.plan_id }, current: { plan: planId } }
        });
      });
    }
  }

  return { success: true, updatedTx: tx.id, newStatus };
}
