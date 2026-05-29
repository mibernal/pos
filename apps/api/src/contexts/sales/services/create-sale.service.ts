import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import type { Kysely } from 'kysely';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { normalizeSalePayments } from './payments.js';
import { computeTaxes, type ComputeTaxesLineInput } from '../../../shared/domain/tax/index.js';
import {
  getNextSaleNumberForBranchInTransaction,
  isSaleNumberUniqueConstraintError
} from '../domain/sale-numbering-service.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';
import { env } from '../../../app/env.js';
import { mapSaleRow, serializeJsonArrayForDb, saleColumnList } from './sale-mapper.js';
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

  const normalizedPayments = normalizeSalePayments(payload.payments);

  let createdSale: ReturnType<typeof loadExistingSaleByClientUuid> extends Promise<infer R> ? Exclude<R, null> : never;
  const maxNumberingAttempts = 2;
  let lastCreateError: unknown = null;

  const createSaleInTransaction = () =>
    db.transaction().execute(async (trx) => {
      const cashSession = await trx
        .selectFrom('cash_sessions')
        .select(['id', 'closed_at', 'branch_id', 'opened_by_user_id'])
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

      if (userRole === 'CASHIER' && cashSession.opened_by_user_id !== userId) {
        throw new AppError(
          403,
          'CASH_SESSION_FORBIDDEN',
          'No puedes registrar ventas en una caja abierta por otro cajero'
        );
      }

      if (cashSession.closed_at) {
        throw new AppError(409, 'CASH_SESSION_CLOSED', 'La sesión de caja ya fue cerrada');
      }

      const tenant = await trx
        .selectFrom('tenants')
        .select(['id', 'tax_mode', 'allow_negative_stock'])
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

      // Pre-fetch active promotions for these products
      const activePromotions = await trx
        .selectFrom('promotions')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('product_id', 'in', uniqueProductIds)
        .where('active', '=', true)
        .where('start_date', '<=', sql<Date>`NOW()`)
        .where(
          sql<boolean>`(end_date IS NULL OR end_date >= NOW())`
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

        let effectivePriceCents = item.price_cents ?? product.price_cents;
        
        // Drift validation for offline sales
        if (item.price_cents !== undefined && item.price_cents !== product.price_cents) {
           const drift = Math.abs(item.price_cents - product.price_cents) / product.price_cents;
           if (drift > 0.10) {
              throw new AppError(400, 'PRICE_DRIFT_EXCEEDED', `El precio del producto ${item.product_id} ha cambiado drásticamente. Por favor, actualiza el catálogo.`);
           }
        }
        
        if (item.variant_id) {
          const variant = variantsById.get(item.variant_id);
          if (!variant || variant.product_id !== product.id) {
             throw new AppError(400, 'VARIANT_NOT_FOUND', `Variante inválida o no encontrada: ${item.variant_id}`);
          }
          if (!variant.active) {
             throw new AppError(400, 'VARIANT_INACTIVE', `Variante inactiva: ${item.variant_id}`);
          }
          
          effectivePriceCents = item.price_cents ?? variant.price_cents;
          
          // Drift validation for variant offline sales
          if (item.price_cents !== undefined && item.price_cents !== variant.price_cents) {
             const drift = Math.abs(item.price_cents - variant.price_cents) / variant.price_cents;
             if (drift > 0.10) {
                throw new AppError(400, 'PRICE_DRIFT_EXCEEDED', `El precio de la variante ${item.variant_id} ha cambiado drásticamente. Por favor, actualiza el catálogo.`);
             }
          }
        }

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
          tenant_id: tenantId,
          branch_id: payload.branch_id,
          sale_id: saleId,
          product_id: item.product_id,
          variant_id: item.variant_id ?? null,
          qty: item.qty.toString(),
          price_cents: effectivePriceCents,
          line_total_cents: lineTotalCents
        };
      });


      if (payload.discount_cents !== calculatedDiscountCents) {
        // En un entorno real podríamos sobreescribir `payload.discount_cents` en lugar de lanzar error, 
        // pero para evitar cobros sorpresa (el frontend calculó un precio distinto al real), es mejor validar:
        throw new AppError(
          400,
          'SALE_DISCOUNT_MISMATCH',
          `El descuento solicitado (${payload.discount_cents}) no coincide con el calculado por las promociones (${calculatedDiscountCents})`
        );
      }

      if (payload.discount_cents > subtotalCents) {
        throw new AppError(
          400,
          'SALE_DISCOUNT_INVALID',
          'discount_cents no puede ser mayor que subtotal_cents'
        );
      }

      const totalCents = subtotalCents - payload.discount_cents;
      const computedTaxes = computeTaxes({
        taxMode: tenant.tax_mode,
        items: taxItemsForCalculation,
        discount_cents_total: payload.discount_cents
      });

      if (
        computedTaxes.subtotal_cents !== subtotalCents ||
        computedTaxes.discount_cents !== payload.discount_cents ||
        computedTaxes.total_cents !== totalCents
      ) {
        throw new AppError(
          500,
          'TAX_CALCULATION_MISMATCH',
          'Inconsistencia al calcular impuestos para la venta'
        );
      }

      let finalSubtotalCents = subtotalCents;
      let finalDiscountCents = payload.discount_cents;
      let finalTaxTotalCents = computedTaxes.tax_total_cents;
      let finalTotalCents = totalCents;

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
        
        // Override with snapshot totals to prevent cash mismatch
        finalSubtotalCents = payload.snapshot.subtotal_cents;
        finalDiscountCents = payload.snapshot.discount_cents;
        finalTaxTotalCents = payload.snapshot.tax_total_cents;
        finalTotalCents = payload.snapshot.total_cents;
      }

      if (normalizedPayments.total_amount_cents !== finalTotalCents) {
        throw new AppError(
          400,
          'PAYMENTS_TOTAL_MISMATCH',
          'La suma de payments debe ser igual al total de la venta'
        );
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
          tenant_id: tenantId,
          client_uuid: payload.client_uuid,
          customer_id: payload.customer_id ?? null,
          branch_id: payload.branch_id,
          cash_session_id: payload.cash_session_id,
          sale_number: nextSaleNumber,
          status: 'COMPLETED',
          subtotal_cents: finalSubtotalCents,
          discount_cents: finalDiscountCents,
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

      await trx.insertInto('sale_items').values(saleItemsToInsert).execute();

      // C3: Stock guard — verificar saldo disponible antes de descontar inventario.
      // Se agrupan las cantidades por producto (pueden repetirse ítems) y se bloquea
      // el registro con FOR UPDATE para evitar race conditions concurrentes.
      const qtyByProduct = new Map<string, number>();
      for (const item of saleItemsToInsert) {
        qtyByProduct.set(
          item.product_id,
          (qtyByProduct.get(item.product_id) ?? 0) + Number(item.qty)
        );
      }

      const productIdsWithStock = [...qtyByProduct.keys()];
      if (productIdsWithStock.length > 0) {
        const currentBalances = await trx
          .selectFrom('inventory_balances')
          .select(['product_id', 'qty'])
          .where('tenant_id', '=', tenantId)
          .where('branch_id', '=', payload.branch_id)
          .where('product_id', 'in', productIdsWithStock)
          .forUpdate()
          .execute();

        const balanceByProduct = new Map(
          currentBalances.map((b) => [b.product_id, Number(b.qty)])
        );

        // Verificar si el tenant permite stock negativo
        const stockViolations: string[] = [];
        for (const [productId, qtySold] of qtyByProduct.entries()) {
          const currentQty = balanceByProduct.get(productId) ?? 0;
          if (currentQty - qtySold < 0) {
            const productName = productsById.get(productId)?.name ?? productId;
            stockViolations.push(`${productName}: stock=${currentQty}, solicitado=${qtySold}`);
          }
        }

        if (stockViolations.length > 0) {
          if (!tenant.allow_negative_stock) {
             throw new AppError(
               409,
               'NEGATIVE_STOCK_NOT_ALLOWED',
               `Stock insuficiente para completar la venta: ${stockViolations.join(', ')}`
             );
          }
          
          logger.warn(
            {
              ...requestLogContext,
              branchId: payload.branch_id,
              saleId,
              event: 'stock_guard_warning',
              violations: stockViolations
            },
            'Stock insuficiente detectado — inventario quedará negativo'
          );
        }

        // C4: Verificar min_stock_alert_qty para generar alertas
        for (const [productId, qtySold] of qtyByProduct.entries()) {
          const currentQty = balanceByProduct.get(productId) ?? 0;
          const finalQty = currentQty - qtySold;
          const product = productsById.get(productId);
          
          if (product && product.min_stock_alert_qty !== null && finalQty <= product.min_stock_alert_qty) {
            // Generar evento asíncrono para alerta de stock bajo
            await trx
              .insertInto('outbox_events')
              .values({
                id: randomUUID(),
                tenant_id: tenantId,
                type: 'LOW_STOCK_ALERT',
                event_version: 1,
                aggregate_type: 'INVENTORY',
                aggregate_id: productId,
                branch_id: payload.branch_id,
                payload_json: {
                  product_id: productId,
                  branch_id: payload.branch_id,
                  current_qty: finalQty,
                  min_stock_alert_qty: product.min_stock_alert_qty,
                  sale_id: saleId
                },
                metadata_json: {
                  user_id: userId
                },
                status: 'PENDING',
                attempts: 0,
                next_retry_at: null
              })
              .execute();
          }
        }
      }

      for (const item of saleItemsToInsert) {
        const txId = randomUUID();
        await trx
          .insertInto('inventory_transactions')
          .values({
            id: txId,
            tenant_id: tenantId,
            branch_id: payload.branch_id,
            product_id: item.product_id,
            operation: 'SALE',
            reference_id: saleId,
            qty_change: (-Number(item.qty)).toString(),
            notes: `Venta #${nextSaleNumber}`,
            created_by_user_id: userId
          })
          .execute();

        await trx
          .insertInto('inventory_balances')
          .values({
            tenant_id: tenantId,
            branch_id: payload.branch_id,
            product_id: item.product_id,
            qty: (-Number(item.qty)).toString()
          })
          .onConflict((oc) =>
            oc.columns(['tenant_id', 'branch_id', 'product_id']).doUpdateSet({
              qty: sql`inventory_balances.qty + EXCLUDED.qty`,
              updated_at: sql`NOW()`
            })
          )
          .execute();
      }

      await trx
        .insertInto('dian_documents')
        .values({
          id: randomUUID(),
          tenant_id: tenantId,
          sale_id: saleId,
          document_type: 'INVOICE',
          parent_document_id: null,
          provider: env.DIAN_PROVIDER,
          status: 'PENDING',
          cude: null,
          provider_payload_json: {
            sale_id: saleId,
            sale_number: nextSaleNumber
          },
          provider_response_json: null
        })
        .execute();

      await trx
        .insertInto('outbox_events')
        .values({
          id: randomUUID(),
          tenant_id: tenantId,
          type: 'sale.created',
          event_version: 1,
          aggregate_type: 'SALE',
          aggregate_id: saleId,
          branch_id: payload.branch_id,
          payload_json: {
            sale_id: saleId,
            tenant_id: tenantId,
            branch_id: payload.branch_id,
            cash_session_id: payload.cash_session_id,
            sale_number: nextSaleNumber,
            total_cents: finalTotalCents
          },
          metadata_json: {
            user_id: userId
          },
          status: 'PENDING',
          attempts: 0,
          next_retry_at: null
        })
        .execute();

      await writeAuditLog(trx, {
        tenantId,
        branchId: payload.branch_id,
        userId,
        entityType: 'SALE',
        entityId: saleId,
        action: 'SALE_CREATED',
        payloadJson: {
          client_uuid: payload.client_uuid,
          cash_session_id: payload.cash_session_id,
          sale_number: nextSaleNumber,
          items_count: saleItemsToInsert.length,
          subtotal_cents: finalSubtotalCents,
          discount_cents: finalDiscountCents,
          tax_total_cents: finalTaxTotalCents,
          total_cents: finalTotalCents,
          payment_mode: normalizedPayments.mode
        }
      });

      return {
        sale: mapSaleRow(createdSaleRow),
        items: saleItemsToInsert.map((item) => ({
          id: item.id,
          product_id: item.product_id,
          variant_id: item.variant_id,
          qty: Number(item.qty),
          price_cents: item.price_cents,
          line_total_cents: item.line_total_cents
        }))
      };
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

  return { sale: createdSale!, isIdempotentHit: false };
}

async function loadExistingSaleByClientUuid(db: Kysely<Database>, tenantId: string, clientUuid: string) {
  const existingSale = await db
    .selectFrom('sales')
    .select([...saleColumnList])
    .where('tenant_id', '=', tenantId)
    .where('client_uuid', '=', clientUuid)
    .executeTakeFirst();

  if (!existingSale) {
    return null;
  }

  const saleItems = await db
    .selectFrom('sale_items')
    .select(['id', 'product_id', 'variant_id', 'qty', 'price_cents', 'line_total_cents'])
    .where('tenant_id', '=', tenantId)
    .where('sale_id', '=', existingSale.id)
    .orderBy('id', 'asc')
    .execute();

  return {
    sale: mapSaleRow(existingSale),
    items: saleItems.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      variant_id: item.variant_id,
      qty: Number(item.qty),
      price_cents: item.price_cents,
      line_total_cents: item.line_total_cents
    }))
  };
}
