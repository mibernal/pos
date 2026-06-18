import type { Kysely } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { WompiGateway } from '../domain/wompi-gateway.js';
import { MercadoPagoGateway } from '../domain/mercadopago-gateway.js';
import { StripeGateway } from '../domain/stripe-gateway.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';
import { SubscriptionService } from './subscription.service.js';
import { NotificationService } from '../../../shared/infra/notifications/NotificationService.js';
import { TracerHelper } from '../../../shared/infra/tracing/Tracer.js';
import { SemanticAttributes } from '../../../shared/infra/tracing/SemanticAttributes.js';

interface WebhookInput {
  gateway: 'WOMPI' | 'MERCADOPAGO' | 'STRIPE';
  headers: Record<string, string>;
  rawBody: string;
}

export async function processPaymentWebhook(db: Kysely<Database>, input: WebhookInput) {
  return TracerHelper.withSpan('billing', 'billing.webhook.process', {
    [SemanticAttributes.GATEWAY_NAME]: input.gateway
  }, async (span) => {
    const adapter = input.gateway === 'WOMPI' ? new WompiGateway() : input.gateway === 'STRIPE' ? new StripeGateway() : new MercadoPagoGateway();

    // 1. Validar firma criptográfica
    const isValid = adapter.verifyWebhookSignature(input.headers, input.rawBody);
    if (!isValid) {
      const error = new AppError(400, 'BAD_REQUEST', 'Firma de webhook inválida');
      TracerHelper.setSpanError(span, error);
      throw error;
    }

  const payload = JSON.parse(input.rawBody);
  const result = await adapter.parseWebhook(payload);

    if (!result.reference) {
      // Algunas pasarelas envían eventos generales sin referencia. Se ignoran en este MVP prepago.
      span.setAttribute(SemanticAttributes.WEBHOOK_STATUS_RESULT, 'ignored');
      return { success: true, ignored: true };
    }

    span.setAttribute(SemanticAttributes.TRANSACTION_REFERENCE, result.reference);

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

  const notificationService = new NotificationService(db);
  const tenant = await db.selectFrom('tenants').select(['name']).where('id', '=', tx.tenant_id).executeTakeFirst();
  const tenantName = tenant?.name || 'Cliente';

  if (newStatus === 'DECLINED' || newStatus === 'ERROR') {
    await notificationService.notifyPaymentRejected(tx.tenant_id, {
      tenantName,
      reason: 'El banco o la pasarela de pagos rechazó la transacción.'
    });
  }

  // 4. Actualizar el plan si fue Aprobado
  if (newStatus === 'APPROVED') {
    const meta = tx.metadata_json as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const planId = meta?.planId;
    const autoRenew = meta?.autoRenew === true;

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

        // Actualizar preferencia de autoRenew
        await trx.updateTable('tenant_subscriptions')
          .set({ auto_renew: autoRenew, updated_at: new Date() })
          .where('tenant_id', '=', tx.tenant_id)
          .execute();

        await writeAuditLog(trx, {
          tenantId: tx.tenant_id,
          entityType: 'TENANT',
          entityId: tx.tenant_id,
          action: 'TENANT_SUBSCRIPTION_PROCESSED',
          payloadJson: { previous: { plan: sub?.plan_id }, current: { plan: planId } }
        });

        // Notificaciones
        const metaData = tx.metadata_json as any;
        await notificationService.notifyPaymentApproved(tx.tenant_id, {
          tenantName,
          planName: planId,
          amount: metaData?.amount || 0,
          currency: metaData?.currency || 'COP'
        });

        if (sub?.plan_id && sub.plan_id !== planId) {
          await notificationService.notifyPlanChanged(tx.tenant_id, {
            tenantName,
            oldPlanName: sub.plan_id,
            newPlanName: planId
          });
        }
      });
    }
    }

    span.setAttribute(SemanticAttributes.WEBHOOK_STATUS_RESULT, newStatus);
    return { success: true, updatedTx: tx.id, newStatus };
  });
}
