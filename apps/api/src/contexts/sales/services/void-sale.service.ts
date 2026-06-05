import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import type { Kysely } from 'kysely';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';
import { env } from '../../../app/env.js';
import { mapSaleRow, saleColumnList } from './sale-mapper.js';
import { ensureUserCanAccessBranch } from '../../../shared/infra/security/permissions.js';
import type { AuthContext } from '../../../shared/infra/security/types.js';
import { LedgerService } from '../../../shared/infra/db/ledger-service.js';

interface VoidSaleServiceInput {
  db: Kysely<Database>;
  tenantId: string;
  auth: AuthContext;
  saleId: string;
  payload: {
    void_reason: string;
  };
}

export async function voidSaleService(input: VoidSaleServiceInput) {
  const { db, tenantId, auth, saleId, payload } = input;

  const voidedSale = await db.transaction().execute(async (trx) => {
    // CRIT-005: Activar contexto RLS para que la política tenant_isolation_policy
    // de la tabla sales sea efectiva en esta transacción de anulación.
    // SET LOCAL expira automáticamente al hacer COMMIT/ROLLBACK.
    await sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`.execute(trx);

    const currentSale = await trx
      .selectFrom('sales')
      .select([
        'id',
        'branch_id',
        'sale_number',
        'status',
        'total_cents',
        'tax_total_cents',
        'cash_session_id',
        'void_reason',
        'voided_by_user_id',
        'voided_at',
        'created_at'
      ])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', saleId)
      .forUpdate()
      .executeTakeFirst();

    if (!currentSale) {
      throw new AppError(404, 'SALE_NOT_FOUND', 'Venta no encontrada');
    }

    ensureUserCanAccessBranch(auth, currentSale.branch_id);

    if (currentSale.status === 'VOID') {
      throw new AppError(409, 'SALE_ALREADY_VOID', 'La venta ya está anulada');
    }

    // C9: Validar ventana temporal de anulación
    const ageHours = (Date.now() - currentSale.created_at.getTime()) / (1000 * 60 * 60);
    if (ageHours > env.SALE_VOID_MAX_AGE_HOURS) {
      throw new AppError(
        409,
        'SALE_VOID_WINDOW_EXPIRED',
        `La venta solo puede anularse dentro de las primeras ${env.SALE_VOID_MAX_AGE_HOURS}h de creación`
      );
    }

    const dianDocument = await trx
      .selectFrom('dian_documents')
      .select(['id', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('sale_id', '=', currentSale.id)
      .where('document_type', '=', 'INVOICE')
      .executeTakeFirst();

    const voidedAt = new Date();
    const now = new Date();

    const updatedSale = await trx
      .updateTable('sales')
      .set({
        status: 'VOID',
        void_reason: payload.void_reason,
        voided_by_user_id: auth.userId,
        voided_at: now
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', saleId)
      .returning([...saleColumnList])
      .executeTakeFirstOrThrow();

    await LedgerService.appendSalesLedger(trx, {
      tenantId,
      saleId: updatedSale.id,
      type: 'SALE_VOID',
      amountCents: -Number(currentSale.total_cents),
      taxAmountCents: -Number(currentSale.tax_total_cents),
      userId: auth.userId
    });

    const cashSession = await trx.selectFrom('cash_sessions').select('terminal_id').where('id', '=', currentSale.cash_session_id).executeTakeFirst();
    if (cashSession) {
      await LedgerService.appendCashLedger(trx, {
        tenantId,
        cashSessionId: currentSale.cash_session_id,
        terminalId: cashSession.terminal_id,
        type: 'CASH_REFUND',
        amountCents: -Number(currentSale.total_cents),
        balanceAfterCents: 0
      });
    }

    const saleItems = await trx
      .selectFrom('sale_items')
      .select(['product_id', 'variant_id', 'qty'])
      .where('tenant_id', '=', tenantId)
      .where('sale_id', '=', saleId)
      .execute();

    const sortedSaleItems = [...saleItems].sort((a, b) => {
      const keyA = `${a.product_id}|${a.variant_id ?? ''}`;
      const keyB = `${b.product_id}|${b.variant_id ?? ''}`;
      return keyA.localeCompare(keyB);
    });

    for (const item of sortedSaleItems) {
      const txId = randomUUID();
      await trx
        .insertInto('inventory_transactions')
        .values({
          id: txId,
          tenant_id: tenantId,
          branch_id: updatedSale.branch_id,
          product_id: item.product_id,
          variant_id: item.variant_id ?? null,
          operation: 'SALE_VOID',
          reference_id: updatedSale.id,
          qty_change: Number(item.qty).toString(),
          notes: `Anulación Venta #${updatedSale.sale_number}`,
          created_by_user_id: auth.userId
        })
        .execute();

      const result = await trx.insertInto('inventory_balances')
        .values({
          tenant_id: tenantId,
          branch_id: updatedSale.branch_id,
          product_id: item.product_id,
          variant_id: item.variant_id ?? null,
          on_hand_qty: Number(item.qty).toString()
        })
        .onConflict((oc) => oc.expression(sql`tenant_id, branch_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000')`)
          .doUpdateSet({
            on_hand_qty: sql`inventory_balances.on_hand_qty + EXCLUDED.on_hand_qty`,
            updated_at: sql`NOW()`
          }))
        .returning('on_hand_qty')
        .executeTakeFirst();

      await LedgerService.appendInventoryLedger(trx, {
        tenantId,
        branchId: updatedSale.branch_id,
        productId: item.product_id,
        variantId: item.variant_id ?? null,
        operation: 'VOID_RESTOCK',
        qtyChange: Number(item.qty),
        balanceAfter: result ? Number(result.on_hand_qty) : Number(item.qty),
        referenceId: updatedSale.id
      });
    }

    await writeAuditLog(trx, {
      tenantId,
      branchId: updatedSale.branch_id,
      userId: auth.userId,
      entityType: 'SALE',
      entityId: updatedSale.id,
      action: 'SALE_VOIDED',
      payloadJson: {
        sale_number: updatedSale.sale_number,
        previous_status: currentSale.status,
        new_status: updatedSale.status,
        total_cents: updatedSale.total_cents,
        void_reason: updatedSale.void_reason,
        voided_at: voidedAt.toISOString(),
        dian_document_id: dianDocument?.id ?? null,
        dian_status: dianDocument?.status ?? null,
        dian_adjustment_pending: Boolean(dianDocument)
      }
    });

    if (dianDocument) {
      await trx
        .insertInto('outbox_events')
        .values({
          id: randomUUID(),
          tenant_id: tenantId,
          type: 'sale.voided',
          event_version: 1,
          aggregate_type: 'SALE',
          aggregate_id: updatedSale.id,
          branch_id: updatedSale.branch_id,
          payload_json: {
            sale_id: updatedSale.id,
            tenant_id: tenantId,
            branch_id: updatedSale.branch_id,
            invoice_dian_document_id: dianDocument.id,
            sale_number: updatedSale.sale_number,
            total_cents: updatedSale.total_cents,
            void_reason: updatedSale.void_reason
          },
          metadata_json: {
            user_id: auth.userId
          },
          status: 'PENDING',
          attempts: 0,
          next_retry_at: null
        })
        .execute();
    }

    return mapSaleRow(updatedSale);
  });

  return voidedSale;
}
