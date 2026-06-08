import type { Kysely } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { WompiGateway } from '../domain/wompi-gateway.js';
import { MercadoPagoGateway } from '../domain/mercadopago-gateway.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';

interface WebhookInput {
  gateway: 'WOMPI' | 'MERCADOPAGO';
  headers: Record<string, string>;
  rawBody: string;
}

export async function processPaymentWebhook(db: Kysely<Database>, input: WebhookInput) {
  const adapter = input.gateway === 'WOMPI' ? new WompiGateway() : new MercadoPagoGateway();

  // 1. Validar firma criptográfica
  const isValid = adapter.verifyWebhookSignature(input.headers, input.rawBody);
  if (!isValid) {
    throw new AppError(400, 'BAD_REQUEST', 'Firma de webhook inválida');
  }

  const payload = JSON.parse(input.rawBody);
  const result = adapter.parseWebhook(payload);

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
  await db
    .updateTable('payment_transactions')
    .set({
      status: newStatus,
      gateway_transaction_id: result.gatewayTransactionId || null,
      updated_at: new Date()
    })
    .where('id', '=', tx.id)
    .execute();

  // 4. Actualizar el plan si fue Aprobado
  if (newStatus === 'APPROVED') {
    const meta = tx.metadata_json as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const planId = meta?.planId;

    if (planId) {
      await db.transaction().execute(async (trx) => {
        const tenant = await trx.selectFrom('tenants').select(['plan']).where('id', '=', tx.tenant_id).executeTakeFirst();
        
        await trx
          .updateTable('tenants')
          .set({ plan: planId, status: 'ACTIVE' })
          .where('id', '=', tx.tenant_id)
          .execute();

        // En un modelo recurrente se actualizaría tenant_subscriptions (fecha actual + 1 mes). 
        // Para prepago básico actualizamos directamente tenants.plan y permitimos el login.

        await writeAuditLog(trx, {
          tenantId: tx.tenant_id,
          entityType: 'TENANT',
          entityId: tx.tenant_id,
          action: 'TENANT_PLAN_UPGRADED',
          payloadJson: { previous: { plan: tenant?.plan }, current: { plan: planId } }
        });
      });
    }
  }

  return { success: true, updatedTx: tx.id, newStatus };
}
