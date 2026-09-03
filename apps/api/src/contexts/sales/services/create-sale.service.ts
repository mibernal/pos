import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import type { Kysely } from 'kysely';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { normalizeSalePayments } from './payments.js';
import { PaymentMethodsRepository } from '../infra/payment-methods.repository.js';
import { computeTaxes, type ComputeTaxesLineInput } from '../../../shared/domain/tax/index.js';
import {
  getNextSaleNumberForBranchInTransaction,
  isSaleNumberUniqueConstraintError
} from '../domain/sale-numbering-service.js';

import { mapSaleRow, serializeJsonArrayForDb, saleColumnList } from './sale-mapper.js';
import { OutboxPublisher } from '../../../shared/infra/outbox/OutboxPublisher.js';
import { SaleCreatedEvent } from '../domain/events/SaleCreatedEvent.js';

import { LedgerService } from '../../../shared/infra/db/ledger-service.js';
import { executeAsTenant } from '../../../shared/infra/db/rls.js';
import { TracerHelper } from '../../../shared/infra/tracing/Tracer.js';
import { SemanticAttributes } from '../../../shared/infra/tracing/SemanticAttributes.js';
import type { FastifyBaseLogger } from 'fastify';
import type { CreateSaleBodyInput } from './schemas.js';

interface CreateSaleServiceInput {
  db: Kysely<Database>;
  logger: FastifyBaseLogger;
  tenantId: string;
  userId: string;
  userRole: string;
  payload: CreateSaleBodyInput;
  requestLogContext: Record<string, unknown>;
}

interface SaleInsertItem {
  id: string;
  tenant_id: string;
  branch_id: string;
  sale_id: string;
  product_id: string;
  variant_id: string | null;
  qty: string;
  price_cents: number;
  line_total_cents: number;
}

export async function createSaleService(input: CreateSaleServiceInput) {
  const { db, logger, tenantId, userId, userRole, payload, requestLogContext } = input;

  // Idempotency pre-check
  const existingSale = await loadExistingSaleByClientUuid(db, tenantId, payload.client_uuid);
  if (existingSale) {
    logger.info(
      {
        ...requestLogContext,
        branchId: existingSale.sale.branch_id,
        saleId: existingSale.sale.id,
        event: 'sale_idempotency_hit',
        client_uuid: payload.client_uuid,
        sale_number: existingSale.sale.sale_number
      },
      'Sale already exists for client_uuid'
    );
    return { sale: existingSale, isIdempotentHit: true };
  }

  let createdSale: ReturnType<typeof loadExistingSaleByClientUuid> extends Promise<infer R> ? Exclude<R, null> : never;
  const maxNumberingAttempts = 2;
  let lastCreateError: unknown = null;

  const createSaleInTransaction = () =>
    TracerHelper.withSpan('sales', 'sales.process', {
      [SemanticAttributes.TENANT_ID]: tenantId,
      [SemanticAttributes.SALE_ITEMS_COUNT]: payload.items.length
    }, async (span) => {
      return db.transaction().execute(async (trx) => {
        // Configurar el contexto RLS para esta transacción
        await sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`.execute(trx);

        /**
         * Los pagos se normalizan **dentro** de la transacción porque se validan contra el
         * catálogo del comercio: qué medios existen, cuáles están encendidos y cuáles
         * exigen referencia. Hacerlo fuera sería comprobar contra un catálogo que puede
         * haber cambiado antes de que la venta se escriba.
         */
        const paymentCatalog = await PaymentMethodsRepository.loadCatalog(trx, tenantId);
        const normalizedPayments = normalizeSalePayments(payload.payments, paymentCatalog);

        /**
         * Fiar exige saber a quién. Sin cliente, la venta a crédito no genera cuenta por
         * cobrar y el importe desaparece: ni está en el cajón ni se le puede reclamar a
         * nadie.
         */
        if (normalizedPayments.payments.some((payment) => payment.method === 'STORE_CREDIT') && !payload.customer_id) {
          throw new AppError(
            400,
            'CUSTOMER_REQUIRED_FOR_CREDIT',
            'Una venta a crédito necesita un cliente identificado'
          );
        }

        let cashSession = await trx
          .selectFrom('cash_sessions')
          .select(['id', 'closed_at', 'branch_id', 'opened_by_user_id', 'terminal_id'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', payload.cash_session_id)
          .forUpdate()
          .executeTakeFirst();

        if (!cashSession || cashSession.branch_id !== payload.branch_id) {
          throw new AppError(
            400,
            'CASH_SESSION_NOT_FOUND',
            'La sesión de caja no existe para la sucursal indicada'
          );
        }

        if (cashSession.closed_at) {
          // Si la sesión original está cerrada (común en sync offline retrasado), buscar la sesión activa actual
          const activeSession = await trx
            .selectFrom('cash_sessions')
            .select(['id', 'closed_at', 'branch_id', 'opened_by_user_id', 'terminal_id'])
            .where('tenant_id', '=', tenantId)
            .where('branch_id', '=', payload.branch_id)
            .where('opened_by_user_id', '=', userId)
            .where('closed_at', 'is', null)
            .forUpdate()
            .executeTakeFirst();

          if (!activeSession) {
            throw new AppError(
              409, 
              'CASH_SESSION_CLOSED', 
              'La sesión de caja original ya fue cerrada y no tienes una sesión abierta actualmente para sincronizar la venta.'
            );
          }
          
          logger.warn(
            { ...requestLogContext, original_session: cashSession.id, new_session: activeSession.id },
            'Reasignando venta offline a la sesión de caja actualmente abierta.'
          );
          cashSession = activeSession;
          payload.cash_session_id = activeSession.id;
        }

        if (userRole === 'CASHIER' && cashSession.opened_by_user_id !== userId) {
          throw new AppError(
            403,
            'CASH_SESSION_FORBIDDEN',
            'No puedes registrar ventas en una caja abierta por otro cajero'
          );
        }

        const tenant = await trx
          .selectFrom('tenants')
          .select([
            'id', 
            'tax_mode', 
            'allow_negative_stock', 
            'enable_tips as module_tips',
            'enable_delivery as module_delivery',
            'enable_product_modifiers as module_modifiers'
          ])
          .where('id', '=', tenantId)
          .executeTakeFirst();

        if (!tenant) {
          throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant no encontrado');
        }

        const uniqueProductIds = [...new Set(payload.items.map((item) => item.product_id))];
        const products = await trx
          .selectFrom('products')
          .select(['id', 'name', 'branch_id', 'price_cents', 'tax_category', 'active', 'min_stock_alert_qty'])
          .where('tenant_id', '=', tenantId)
          .where('id', 'in', uniqueProductIds)
          .where(
            sql<boolean>`(products.branch_id = ${payload.branch_id} OR products.branch_id IS NULL)`
          )
          .execute();

        const productsById = new Map(products.map((product) => [product.id, product]));

        // Pre-fetch variants if needed
        const requestedVariantIds = payload.items.filter(i => i.variant_id).map(i => i.variant_id as string);
        const variantsById = new Map<string, { id: string; product_id: string; price_cents: number; active: boolean }>();

        if (requestedVariantIds.length > 0) {
          const variants = await trx
            .selectFrom('product_variants')
            .select(['id', 'product_id', 'price_cents', 'active'])
            .where('tenant_id', '=', tenantId)
            .where('id', 'in', requestedVariantIds)
            .execute();

          variants.forEach(v => variantsById.set(v.id, v));
        }

        // Pre-fetch modifiers if needed
        const requestedModifierOptionIds = payload.items.flatMap(i => i.modifiers ?? []);
        const modifierOptionsById = new Map<string, { id: string; extra_price_cents: number; is_active: boolean }>();

        if (requestedModifierOptionIds.length > 0) {
          const modifierOptions = await trx
            .selectFrom('product_modifier_options')
            .select(['id', 'extra_price_cents', 'is_active'])
            .where('tenant_id', '=', tenantId)
            .where('id', 'in', requestedModifierOptionIds)
            .execute();
          
          modifierOptions.forEach(m => modifierOptionsById.set(m.id, m));
        }

        // Pre-fetch active promotions for these products
        const activePromotions = await trx
          .selectFrom('promotions')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('product_id', 'in', uniqueProductIds)
          .where('active', '=', true)
          .where('start_date', '<=', sql<Date>`CURRENT_TIMESTAMP`)
          .where(
            sql<boolean>`(end_date IS NULL OR end_date >= CURRENT_TIMESTAMP)`
          )
          .execute();

        const promotionsByProductId = new Map<string, typeof activePromotions[0]>();
        for (const promo of activePromotions) {
          // Simple logic: first active promotion per product applies
          if (!promotionsByProductId.has(promo.product_id)) {
            promotionsByProductId.set(promo.product_id, promo);
          }
        }

        const saleId = randomUUID();
        let subtotalCents = 0;
        let calculatedDiscountCents = 0;
        const taxItemsForCalculation: ComputeTaxesLineInput[] = [];
        const saleItemsToInsert: SaleInsertItem[] = payload.items.map((item) => {
          const product = productsById.get(item.product_id);
          if (!product) {
            throw new AppError(
              400,
              'PRODUCT_NOT_FOUND',
              `Producto no encontrado o fuera de alcance: ${item.product_id}`
            );
          }

          if (!product.active) {
            throw new AppError(400, 'PRODUCT_INACTIVE', `Producto inactivo: ${item.product_id}`);
          }

          let basePrice = product.price_cents;

          if (item.variant_id) {
            const variant = variantsById.get(item.variant_id);
            if (!variant || variant.product_id !== product.id) {
              throw new AppError(400, 'VARIANT_NOT_FOUND', `Variante inválida o no encontrada: ${item.variant_id}`);
            }
            if (!variant.active) {
              throw new AppError(400, 'VARIANT_INACTIVE', `Variante inactiva: ${item.variant_id}`);
            }
            basePrice = variant.price_cents;
          }

          let effectivePriceCents = item.price_cents ?? basePrice;

          // Drift validation for offline sales (comparing base prices without modifiers)
          if (item.price_cents !== undefined && item.price_cents !== basePrice) {
            const drift = Math.abs(item.price_cents - basePrice) / (basePrice || 1);
            if (drift > 0.10) {
              throw new AppError(400, 'PRICE_DRIFT_EXCEEDED', `El precio base del producto o variante ha cambiado drásticamente. Por favor, actualiza el catálogo.`);
            }
          }

          const modifierSum = (item.modifiers ?? []).reduce((sum, modId) => {
            const modOpt = modifierOptionsById.get(modId);
            if (!modOpt || !modOpt.is_active) {
              throw new AppError(400, 'MODIFIER_NOT_FOUND', `Modificador inválido o inactivo: ${modId}`);
            }
            return sum + modOpt.extra_price_cents;
          }, 0);
          effectivePriceCents += modifierSum;

          const lineTotalCents = Math.round(item.qty * effectivePriceCents);
          subtotalCents += lineTotalCents;

          // Compute line discount
          let lineDiscountCents = 0;
          const promo = promotionsByProductId.get(item.product_id);
          if (promo) {
            if (promo.type === 'PERCENTAGE') {
              lineDiscountCents = Math.round((lineTotalCents * promo.value_cents) / 10000);
            } else if (promo.type === 'FIXED_AMOUNT') {
              lineDiscountCents = promo.value_cents * item.qty;
            } else if (promo.type === 'BUY_X_GET_Y' && promo.buy_qty && promo.get_qty) {
              const timesApplied = Math.floor(item.qty / promo.buy_qty);
              const freeItems = timesApplied * promo.get_qty;
              // Ensure we don't discount more items than bought
              const validFreeItems = Math.min(freeItems, item.qty);
              lineDiscountCents = validFreeItems * effectivePriceCents;
            }
          }
          calculatedDiscountCents += lineDiscountCents;

          taxItemsForCalculation.push({
            qty: item.qty,
            price_cents_final: effectivePriceCents,
            tax_category: product.tax_category
          });

          return {
            id: randomUUID(),
            tenant_id: tenantId!,
            branch_id: payload.branch_id,
            sale_id: saleId,
            product_id: item.product_id,
            variant_id: item.variant_id ?? null,
            qty: item.qty.toString(),
            price_cents: effectivePriceCents,
            line_total_cents: lineTotalCents,
            notes: item.notes ?? null,
            modifiers_json: item.modifiers ? JSON.stringify(item.modifiers) : null
          };
        });


        let discountOverrideReason: string | undefined;

        if (payload.discount_cents !== calculatedDiscountCents) {
          logger.warn(
            {
              ...requestLogContext,
              branchId: payload.branch_id,
              event: 'sale_discount_override',
              requested_discount: payload.discount_cents,
              calculated_discount: calculatedDiscountCents
            },
            'El descuento solicitado no coincide con el calculado por las promociones. Se usará el valor del servidor.'
          );
          payload.discount_cents = calculatedDiscountCents;
          discountOverrideReason = 'Ajuste de descuento por promociones activas (Sincronización servidor)';
        }

        if (payload.discount_cents > subtotalCents) {
          throw new AppError(
            400,
            'SALE_DISCOUNT_INVALID',
            'discount_cents no puede ser mayor que subtotal_cents'
          );
        }

        const tipCents = payload.tip_cents ?? 0;
        if (tipCents > 0 && !tenant.module_tips) {
          throw new AppError(400, 'TIPS_NOT_ENABLED', 'Las propinas no están habilitadas para este comercio');
        }
        const totalCents = subtotalCents - payload.discount_cents + tipCents;
        const computedTaxes = computeTaxes({
          taxMode: tenant.tax_mode as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          items: taxItemsForCalculation,
          discount_cents_total: payload.discount_cents
        });

        // El backend es la fuente de verdad. Si hay desviación, logueamos un warning pero NO bloqueamos 
        // la venta siempre y cuando los pagos coincidan con el monto requerido por el servidor.
        if (
          computedTaxes.subtotal_cents !== subtotalCents ||
          computedTaxes.total_cents !== payload.snapshot?.total_cents ||
          computedTaxes.tax_total_cents !== payload.snapshot?.tax_total_cents
        ) {
          logger.warn(
            {
              ...requestLogContext,
              branchId: payload.branch_id,
              event: 'sale_drift_detected',
              payload_snapshot: payload.snapshot,
              server_calculated: {
                subtotal: subtotalCents,
                discount: payload.discount_cents,
                tip: tipCents,
                taxes: computedTaxes.tax_total_cents,
                total: computedTaxes.total_cents + tipCents
              }
            },
            'Drift detectado entre los cálculos del frontend y del backend. El backend prevalecerá.'
          );
        }

        if (normalizedPayments.total_amount_cents < (computedTaxes.total_cents + tipCents)) {
          throw new AppError(
            400,
            'PAYMENTS_INSUFFICIENT',
            `Los pagos (${normalizedPayments.total_amount_cents}) no cubren el total de la venta calculado por el servidor (${computedTaxes.total_cents + tipCents})`
          );
        }

        const finalSubtotalCents = subtotalCents;
        const finalDiscountCents = payload.discount_cents;
        const finalTaxTotalCents = computedTaxes.tax_total_cents;
        const finalTotalCents = totalCents;

        // Diferencia entre lo que el cliente creía cobrar y lo que el servidor calculó.
        // Se guarda en la auditoría de la venta para poder investigarla, en vez de
        // quedar solo en una línea de log.
        let snapshotDiscrepancy: {
          client: { subtotal_cents: number; discount_cents: number; tax_total_cents: number; total_cents: number };
          server: { subtotal_cents: number; discount_cents: number; tax_total_cents: number; total_cents: number };
        } | null = null;

        if (payload.snapshot) {
          if (payload.snapshot.total_cents !== totalCents) {
            const drift = Math.abs(payload.snapshot.total_cents - totalCents) / totalCents;
            if (drift > 0.10) {
              throw new AppError(
                400,
                'PRICE_DRIFT_EXCEEDED',
                `El total cobrado offline (${payload.snapshot.total_cents}) difiere más del 10% del total actual (${totalCents}). Actualiza el catálogo.`
              );
            }
          }

          // El snapshot se COMPARA, nunca se copia. Antes se sobrescribían subtotal,
          // descuento, impuesto y total con lo que mandaba el cliente, de modo que un
          // frontend comprometido o con un error podía fijar la base gravable que iba al
          // documento DIAN, con solo un 10% de margen como barrera.
          //
          // El servidor ya trabaja con los precios de la venta offline: cada ítem envía su
          // `price_cents` y arriba se valida su deriva línea a línea. Lo que se factura es,
          // por tanto, lo que se cobró — pero el impuesto lo determina siempre el servidor a
          // partir de la `tax_category` que tiene el producto en base de datos.
          if (
            payload.snapshot.subtotal_cents !== subtotalCents ||
            payload.snapshot.total_cents !== totalCents ||
            (payload.snapshot.tax_total_cents !== 0 &&
              payload.snapshot.tax_total_cents !== computedTaxes.tax_total_cents)
          ) {
            snapshotDiscrepancy = {
              client: {
                subtotal_cents: payload.snapshot.subtotal_cents,
                discount_cents: payload.snapshot.discount_cents,
                tax_total_cents: payload.snapshot.tax_total_cents,
                total_cents: payload.snapshot.total_cents
              },
              server: {
                subtotal_cents: subtotalCents,
                discount_cents: payload.discount_cents,
                tax_total_cents: computedTaxes.tax_total_cents,
                total_cents: totalCents
              }
            };
          }
        }

        if (normalizedPayments.total_amount_cents !== finalTotalCents) {
          if (!discountOverrideReason) {
            throw new AppError(
              400,
              'PAYMENTS_TOTAL_MISMATCH',
              'La suma de payments debe ser igual al total de la venta'
            );
          } else {
            logger.warn(
              {
                ...requestLogContext,
                event: 'payment_total_mismatch_allowed',
                payments_total: normalizedPayments.total_amount_cents,
                sale_total: finalTotalCents
              },
              'Se permite discrepancia en pagos debido a un ajuste automático del descuento'
            );
          }
        }

        const nextSaleNumber = await getNextSaleNumberForBranchInTransaction(trx, {
          tenantId,
          branchId: payload.branch_id
        });

        const paymentJson = {
          mode: normalizedPayments.mode,
          payments: normalizedPayments.payments,
          amounts: normalizedPayments.amounts,
          total_cents: normalizedPayments.total_amount_cents
        };

        const createdSaleRow = await trx
          .insertInto('sales')
          .values({
            id: saleId,
            tenant_id: tenantId!,
            client_uuid: payload.client_uuid,
            customer_id: payload.customer_id ?? null,
            branch_id: payload.branch_id,
            cash_session_id: payload.cash_session_id,
            table_order_id: payload.table_order_id ?? null,
            waiter_id: payload.waiterId ?? null,
            sale_number: nextSaleNumber,
            status: 'COMPLETED',
            subtotal_cents: finalSubtotalCents,
            discount_cents: finalDiscountCents,
            tip_cents: tipCents,
            total_cents: finalTotalCents,
            tax_total_cents: finalTaxTotalCents,
            tax_lines_json: serializeJsonArrayForDb(computedTaxes.tax_lines_json),
            payment_json: paymentJson,
            created_by_user_id: userId,
            void_reason: null,
            voided_by_user_id: null,
            voided_at: null
          })
          .returning([...saleColumnList])
          .executeTakeFirstOrThrow();

        /**
         * Los pagos, como filas. `payment_json` sigue guardándose —es lo que envió el
         * cliente y sirve de respaldo— pero deja de ser la fuente de verdad: el arqueo y el
         * Z leen de aquí, donde cada pago tiene su tipo, su referencia y su vuelto.
         */
        await trx
          .insertInto('sale_payments')
          .values(
            normalizedPayments.payments.map((payment) => ({
              id: randomUUID(),
              tenant_id: tenantId!,
              branch_id: payload.branch_id,
              sale_id: saleId,
              cash_session_id: payload.cash_session_id,
              method_code: payment.method_code,
              kind: payment.method,
              amount_cents: payment.amount_cents,
              tendered_cents: payment.tendered_cents ?? null,
              change_cents: payment.change_cents ?? null,
              reference: payment.reference ?? null,
              metadata_json: null
            }))
          )
          .execute();

        await LedgerService.appendSalesLedger(trx, {
          tenantId,
          saleId,
          type: 'SALE_CREATION',
          amountCents: finalTotalCents,
          taxAmountCents: finalTaxTotalCents,
          userId
        });

        span.setAttribute(SemanticAttributes.SALE_ID, saleId);
        span.setAttribute(SemanticAttributes.SALE_TOTAL_CENTS, finalTotalCents);
        span.setAttribute(SemanticAttributes.SALE_PAYMENT_MODE, normalizedPayments.mode);

        // Al cajón solo entra el efectivo. Registrar aquí el total de la venta hacía que
        // tarjeta y transferencia inflaran el esperado del arqueo, de modo que todo cierre
        // de caja arrojaba faltante y el cajero terminaba ignorando la cifra.
        const cashComponentCents = normalizedPayments.amounts.cash_cents;

        if (cashComponentCents > 0) {
          const sessionLedger = await trx.selectFrom('cash_ledger')
            .select(trx.fn.sum('amount_cents').as('current_balance'))
            .where('cash_session_id', '=', payload.cash_session_id)
            .executeTakeFirst();
          const currentCashBalance = Number(sessionLedger?.current_balance || 0);

          await LedgerService.appendCashLedger(trx, {
            tenantId,
            cashSessionId: payload.cash_session_id,
            terminalId: cashSession.terminal_id,
            type: 'CASH_SALE',
            amountCents: cashComponentCents,
            balanceAfterCents: currentCashBalance + cashComponentCents
          });
        }

        await trx.insertInto('sale_items').values(saleItemsToInsert).execute();

        const saleCreatedEvent = new SaleCreatedEvent({
          sale_id: saleId,
          tenant_id: tenantId!,
          branch_id: payload.branch_id,
          cash_session_id: payload.cash_session_id,
          sale_number: nextSaleNumber,
          total_cents: finalTotalCents,
          table_order_id: payload.table_order_id,
          audit_payload: {
            client_uuid: payload.client_uuid,
            items_count: saleItemsToInsert.length,
            subtotal_cents: finalSubtotalCents,
            discount_cents: finalDiscountCents,
            tax_total_cents: finalTaxTotalCents,
            payment_mode: normalizedPayments.mode,
            ...(snapshotDiscrepancy ? { snapshot_discrepancy: snapshotDiscrepancy } : {})
          }
        }, saleId, payload.branch_id);

        const publisher = new OutboxPublisher(trx);
        await publisher.publish(saleCreatedEvent, tenantId, userId);

        return {
          sale: mapSaleRow(createdSaleRow),
          items: saleItemsToInsert.map((item) => ({
            id: item.id,
            product_id: item.product_id,
            variant_id: item.variant_id,
            qty: Number(item.qty),
            price_cents: item.price_cents,
            line_total_cents: item.line_total_cents
          })),
          discount_override_reason: discountOverrideReason
        };
      });
    });

  for (let attempt = 1; attempt <= maxNumberingAttempts; attempt += 1) {
    try {
      createdSale = await createSaleInTransaction();
      lastCreateError = null;
      break;
    } catch (error) {
      if (isSaleNumberUniqueConstraintError(error) && attempt < maxNumberingAttempts) {
        logger.warn(
          {
            ...requestLogContext,
            branchId: payload.branch_id,
            event: 'sale_number_collision_retry',
            client_uuid: payload.client_uuid,
            attempt
          },
          'Retrying sale creation after sale_number collision'
        );
        lastCreateError = error;
        continue;
      }

      const existingSaleAfterError = await loadExistingSaleByClientUuid(
        db,
        tenantId,
        payload.client_uuid
      );

      if (existingSaleAfterError) {
        logger.info(
          {
            ...requestLogContext,
            branchId: payload.branch_id,
            saleId: existingSaleAfterError.sale.id,
            event: 'sale_idempotency_hit_after_error',
            client_uuid: payload.client_uuid
          },
          'Sale was created in a concurrent transaction despite error'
        );
        return { sale: existingSaleAfterError, isIdempotentHit: true };
      }

      throw error;
    }
  }

  if (lastCreateError) {
    throw lastCreateError;
  }

  // === METRICS HOOK ===
  const { salesCounter, tenantConsumptionCounter } = await import('../../../tracing.js');
  salesCounter.add(1, { branch_id: payload.branch_id, terminal_id: (payload as any).terminal_id }); // eslint-disable-line @typescript-eslint/no-explicit-any
  tenantConsumptionCounter.add(1, { tenant_id: tenantId!, operation: 'create_sale' });

  return { sale: createdSale!, isIdempotentHit: false };
}

async function loadExistingSaleByClientUuid(db: Kysely<Database>, tenantId: string, clientUuid: string) {
  return await executeAsTenant(db, tenantId, async (trx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const existingSale = await trx
      .selectFrom('sales')
      .select([...saleColumnList])
      .where('tenant_id', '=', tenantId)
      .where('client_uuid', '=', clientUuid)
      .executeTakeFirst();

    if (!existingSale) {
      return null;
    }

    const saleItems = await trx
      .selectFrom('sale_items')
      .select(['id', 'product_id', 'variant_id', 'qty', 'price_cents', 'line_total_cents'])
      .where('tenant_id', '=', tenantId)
      .where('sale_id', '=', existingSale.id)
      .orderBy('id', 'asc')
      .execute();

    return {
      sale: mapSaleRow(existingSale),
      items: saleItems.map((item: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        id: item.id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        qty: Number(item.qty),
        price_cents: item.price_cents,
        line_total_cents: item.line_total_cents
      }))
    };
  });
}
