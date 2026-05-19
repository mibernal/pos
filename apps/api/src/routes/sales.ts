import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../infra/errors/app-error.js';
import {
  createSaleBodySchema,
  saleIdParamsSchema,
  salesListQuerySchema,
  voidSaleBodySchema
} from '../modules/sales/schemas.js';
import { buildRequestLogContext } from '../infra/logging/request-log-context.js';
import { mapSaleRow, saleColumnList } from '../modules/sales/sale-mapper.js';
import { createSaleService } from '../modules/sales/create-sale.service.js';
import { voidSaleService } from '../modules/sales/void-sale.service.js';
import { processPartialReturn } from '../modules/sales/create-return.service.js';
import { CreateReturnRequestSchema } from '@pos-dian/shared';

export const salesRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/sales',
    {
      preHandler: [app.requireRoles(['ADMIN', 'MANAGER', 'CASHIER'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        body: createSaleBodySchema
      }
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const payload = createSaleBodySchema.parse(request.body);

      const result = await createSaleService({
        db: app.db,
        logger: request.log,
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        payload,
        requestLogContext: buildRequestLogContext(request, {})
      });

<<<<<<< HEAD
      let createdSale:
        | {
            sale: ReturnType<typeof mapSaleRow>;
            items: Array<{
              id: string;
              product_id: string;
              qty: number;
              price_cents: number;
              line_total_cents: number;
            }>;
          }
        | undefined;

      const createSaleInTransaction = () =>
        app.db.transaction().execute(async (trx) => {
          const cashSession = await trx
            .selectFrom('cash_sessions')
            .select(['id', 'closed_at', 'branch_id'])
            .where('tenant_id', '=', request.auth!.tenantId)
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
            throw new AppError(409, 'CASH_SESSION_CLOSED', 'La sesión de caja ya fue cerrada');
          }

          const tenant = await trx
            .selectFrom('tenants')
            .select(['id', 'tax_mode'])
            .where('id', '=', request.auth!.tenantId)
            .executeTakeFirst();

          if (!tenant) {
            throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant no encontrado');
          }

          const uniqueProductIds = [...new Set(payload.items.map((item) => item.product_id))];
          const products = await trx
            .selectFrom('products')
            .select(['id', 'branch_id', 'price_cents', 'tax_category', 'active'])
            .where('tenant_id', '=', request.auth!.tenantId)
            .where('id', 'in', uniqueProductIds)
            .where(
              sql<boolean>`(products.branch_id = ${payload.branch_id} OR products.branch_id IS NULL)`
            )
            .execute();

          const productsById = new Map(products.map((product) => [product.id, product]));

          const saleId = randomUUID();
          let subtotalCents = 0;
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

            const effectivePriceCents = item.price_cents ?? product.price_cents;
            const lineTotalCents = Math.round(item.qty * effectivePriceCents);
            subtotalCents += lineTotalCents;
            taxItemsForCalculation.push({
              qty: item.qty,
              price_cents_final: effectivePriceCents,
              tax_category: product.tax_category
            });

            return {
              id: randomUUID(),
              tenant_id: request.auth!.tenantId,
              sale_id: saleId,
              product_id: item.product_id,
              qty: item.qty.toString(),
              price_cents: effectivePriceCents,
              line_total_cents: lineTotalCents
            };
          });

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

          if (normalizedPayments.total_amount_cents !== totalCents) {
            throw new AppError(
              400,
              'PAYMENTS_TOTAL_MISMATCH',
              'La suma de payments debe ser igual al total de la venta'
            );
          }

          const nextSaleNumber = await getNextSaleNumberForBranchInTransaction(trx, {
            tenantId: request.auth!.tenantId,
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
              tenant_id: request.auth!.tenantId,
              client_uuid: payload.client_uuid,
              customer_id: payload.customer_id ?? null,
              branch_id: payload.branch_id,
              cash_session_id: payload.cash_session_id,
              sale_number: nextSaleNumber,
              status: 'COMPLETED',
              subtotal_cents: subtotalCents,
              discount_cents: payload.discount_cents,
              total_cents: totalCents,
              tax_total_cents: computedTaxes.tax_total_cents,
              tax_lines_json: serializeJsonArrayForDb(computedTaxes.tax_lines_json),
              payment_json: paymentJson,
              created_by_user_id: request.auth!.userId,
              void_reason: null,
              voided_by_user_id: null,
              voided_at: null
            })
            .returning([...saleColumnList])
            .executeTakeFirstOrThrow();

          await trx.insertInto('sale_items').values(saleItemsToInsert).execute();

          for (const item of saleItemsToInsert) {
            const txId = randomUUID();
            await trx
              .insertInto('inventory_transactions')
              .values({
                id: txId,
                tenant_id: request.auth!.tenantId,
                branch_id: payload.branch_id,
                product_id: item.product_id,
                operation: 'SALE',
                reference_id: saleId,
                qty_change: (-Number(item.qty)).toString(),
                notes: `Venta #${nextSaleNumber}`,
                created_by_user_id: request.auth!.userId
              })
              .execute();

            await trx
              .insertInto('inventory_balances')
              .values({
                tenant_id: request.auth!.tenantId,
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
              tenant_id: request.auth!.tenantId,
              sale_id: saleId,
              document_type: 'INVOICE',
              parent_document_id: null,
              provider: DIAN_PROVIDER,
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
              tenant_id: request.auth!.tenantId,
              type: 'SALE_CREATED',
              aggregate_id: saleId,
              payload_json: {
                sale_id: saleId,
                tenant_id: request.auth!.tenantId,
                branch_id: payload.branch_id,
                cash_session_id: payload.cash_session_id,
                sale_number: nextSaleNumber,
                total_cents: totalCents
              },
              status: 'PENDING',
              attempts: 0,
              next_retry_at: null
            })
            .execute();

          await writeAuditLog(trx, {
            tenantId: request.auth!.tenantId,
            branchId: payload.branch_id,
            userId: request.auth!.userId,
            entityType: 'SALE',
            entityId: saleId,
            action: 'SALE_CREATED',
            payloadJson: {
              client_uuid: payload.client_uuid,
              cash_session_id: payload.cash_session_id,
              sale_number: nextSaleNumber,
              items_count: saleItemsToInsert.length,
              subtotal_cents: subtotalCents,
              discount_cents: payload.discount_cents,
              tax_total_cents: computedTaxes.tax_total_cents,
              total_cents: totalCents,
              payment_mode: normalizedPayments.mode
            }
          });

          return {
            sale: mapSaleRow(createdSaleRow),
            items: saleItemsToInsert.map((item) => ({
              id: item.id,
              product_id: item.product_id,
              qty: Number(item.qty),
              price_cents: item.price_cents,
              line_total_cents: item.line_total_cents
            }))
          };
        });
      const maxNumberingAttempts = 2;
      let lastCreateError: unknown = null;

      for (let attempt = 1; attempt <= maxNumberingAttempts; attempt += 1) {
        try {
          createdSale = await createSaleInTransaction();
          lastCreateError = null;
          break;
        } catch (error) {
          if (isSaleNumberUniqueConstraintError(error) && attempt < maxNumberingAttempts) {
            request.log.warn(
              {
                ...buildRequestLogContext(request, {
                  branchId: payload.branch_id
                }),
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
            request.auth.tenantId,
            payload.client_uuid
          );

          if (existingSaleAfterError) {
            request.log.info(
              {
                ...buildRequestLogContext(request, {
                  branchId: existingSaleAfterError.sale.branch_id,
                  saleId: existingSaleAfterError.sale.id
                }),
                event: 'sale_idempotency_conflict_resolved',
                client_uuid: payload.client_uuid,
                sale_number: existingSaleAfterError.sale.sale_number
              },
              'Sale conflict resolved by idempotency key'
            );

            return reply.code(200).send(existingSaleAfterError);
          }

          throw error;
        }
      }

      if (!createdSale) {
        throw lastCreateError ?? new Error('No fue posible crear la venta');
=======
      if (result.isIdempotentHit) {
        return reply.code(200).send(result.sale);
>>>>>>> aa2b4ca (refactor)
      }

      request.log.info(
        {
          ...buildRequestLogContext(request, {
            branchId: payload.branch_id,
            saleId: result.sale.sale.id
          }),
          event: 'sale_created',
          client_uuid: payload.client_uuid,
          sale_number: result.sale.sale.sale_number,
          cash_session_id: payload.cash_session_id,
          items_count: result.sale.items.length,
          subtotal_cents: result.sale.sale.subtotal_cents,
          discount_cents: result.sale.sale.discount_cents,
          tax_total_cents: result.sale.sale.tax_total_cents,
          total_cents: result.sale.sale.total_cents
        },
        'Sale created'
      );

      return reply.code(201).send(result.sale);
    }
  );

  typedApp.get(
    '/sales',
    {
      preHandler: [app.requireRoles(['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        querystring: salesListQuerySchema
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const query = salesListQuerySchema.parse(request.query);
      const { branch_id: branchId, from, to, limit } = query;

      let queryBuilder = app.db
        .selectFrom('sales')
        .leftJoin('dian_documents', (join) =>
          join
            .onRef('dian_documents.sale_id', '=', 'sales.id')
            .onRef('dian_documents.tenant_id', '=', 'sales.tenant_id')
            .on('dian_documents.document_type', '=', 'INVOICE')
        )
        .selectAll('sales')
        .select('dian_documents.status as dian_status')
        .where('sales.tenant_id', '=', request.auth.tenantId)
        .where('sales.branch_id', '=', branchId);

      if (from) {
        queryBuilder = queryBuilder.where('sales.created_at', '>=', from);
      }

      if (to) {
        queryBuilder = queryBuilder.where('sales.created_at', '<=', to);
      }

      const rows = await queryBuilder
        .orderBy('sales.created_at', 'desc')
        .orderBy('sales.id', 'desc')
        .limit(limit + 1)
        .execute();

      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((row) => mapSaleRow(row));

      return {
        items,
        page: {
          limit,
          count: items.length,
          hasMore
        }
      };
    }
  );

  typedApp.get(
    '/sales/:id',
    {
      preHandler: [app.requireRoles(['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        params: saleIdParamsSchema
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const params = saleIdParamsSchema.parse(request.params);

      const sale = await app.db
        .selectFrom('sales')
        .select([...saleColumnList])
        .where('tenant_id', '=', request.auth.tenantId)
        .where('id', '=', params.id)
        .executeTakeFirst();

      if (!sale) {
        throw new AppError(404, 'SALE_NOT_FOUND', 'Venta no encontrada');
      }

      const saleItems = await app.db
        .selectFrom('sale_items')
        .leftJoin('products', (join) =>
          join
            .onRef('products.id', '=', 'sale_items.product_id')
            .onRef('products.tenant_id', '=', 'sale_items.tenant_id')
        )
        .leftJoin('product_variants', (join) =>
          join
            .onRef('product_variants.id', '=', 'sale_items.variant_id')
            .onRef('product_variants.tenant_id', '=', 'sale_items.tenant_id')
        )
        .select([
          'sale_items.id',
          'sale_items.product_id',
          'sale_items.variant_id',
          'sale_items.qty',
          'sale_items.price_cents',
          'sale_items.line_total_cents',
          'products.name as product_name',
          'product_variants.name as variant_name',
          'products.image_url as product_image_url',
          'products.description as product_description'
        ])
        .where('sale_items.tenant_id', '=', request.auth.tenantId)
        .where('sale_items.sale_id', '=', sale.id)
        .orderBy('sale_items.id', 'asc')
        .execute();

      const dianDocument = await app.db
        .selectFrom('dian_documents')
        .select([
          'id',
          'provider',
          'status',
          'cude',
          'document_type',
          'parent_document_id',
          'created_at',
          'updated_at'
        ])
        .where('tenant_id', '=', request.auth.tenantId)
        .where('sale_id', '=', sale.id)
        .where('document_type', '=', 'INVOICE')
        .executeTakeFirst();

      return {
        sale: mapSaleRow(sale),
        items: saleItems.map((item) => ({
          id: item.id,
          product_id: item.product_id,
          variant_id: item.variant_id,
          product_name: item.product_name,
          variant_name: item.variant_name,
          imageUrl: item.product_image_url,
          description: item.product_description,
          qty: Number(item.qty),
          price_cents: item.price_cents,
          line_total_cents: item.line_total_cents
        })),
        dian_document: dianDocument
          ? {
              id: dianDocument.id,
              provider: dianDocument.provider,
              status: dianDocument.status,
              cude: dianDocument.cude,
              document_type: dianDocument.document_type,
              parent_document_id: dianDocument.parent_document_id,
              created_at: dianDocument.created_at.toISOString(),
              updated_at: dianDocument.updated_at.toISOString()
            }
          : null
      };
    }
  );

  typedApp.post(
    '/sales/:id/void',
    {
      preHandler: [app.requireRoles(['ADMIN', 'MANAGER'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        params: saleIdParamsSchema,
        body: voidSaleBodySchema
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const params = saleIdParamsSchema.parse(request.params);
      const payload = voidSaleBodySchema.parse(request.body);

<<<<<<< HEAD
      const voidedSale = await app.db.transaction().execute(async (trx) => {
        const currentSale = await trx
          .selectFrom('sales')
          .select([
            'id',
            'branch_id',
            'sale_number',
            'status',
            'total_cents',
            'void_reason',
            'voided_by_user_id',
            'voided_at'
          ])
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('id', '=', params.id)
          .forUpdate()
          .executeTakeFirst();

        if (!currentSale) {
          throw new AppError(404, 'SALE_NOT_FOUND', 'Venta no encontrada');
        }

        if (currentSale.status === 'VOID') {
          throw new AppError(409, 'SALE_ALREADY_VOID', 'La venta ya está anulada');
        }

        const dianDocument = await trx
          .selectFrom('dian_documents')
          .select(['id', 'status'])
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('sale_id', '=', currentSale.id)
          .where('document_type', '=', 'INVOICE')
          .executeTakeFirst();

        const voidedAt = new Date();

        const updatedSale = await trx
          .updateTable('sales')
          .set({
            status: 'VOID',
            void_reason: payload.void_reason,
            voided_by_user_id: request.auth!.userId,
            voided_at: voidedAt
          })
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('id', '=', params.id)
          .returning([...saleColumnList])
          .executeTakeFirstOrThrow();

        const saleItems = await trx
          .selectFrom('sale_items')
          .select(['product_id', 'qty'])
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('sale_id', '=', params.id)
          .execute();

        for (const item of saleItems) {
          const txId = randomUUID();
          await trx
            .insertInto('inventory_transactions')
            .values({
              id: txId,
              tenant_id: request.auth!.tenantId,
              branch_id: updatedSale.branch_id,
              product_id: item.product_id,
              operation: 'SALE_VOID',
              reference_id: updatedSale.id,
              qty_change: Number(item.qty).toString(),
              notes: `Anulación Venta #${updatedSale.sale_number}`,
              created_by_user_id: request.auth!.userId
            })
            .execute();

          await trx
            .insertInto('inventory_balances')
            .values({
              tenant_id: request.auth!.tenantId,
              branch_id: updatedSale.branch_id,
              product_id: item.product_id,
              qty: Number(item.qty).toString()
            })
            .onConflict((oc) =>
              oc.columns(['tenant_id', 'branch_id', 'product_id']).doUpdateSet({
                qty: sql`inventory_balances.qty + EXCLUDED.qty`,
                updated_at: sql`NOW()`
              })
            )
            .execute();
        }

        await writeAuditLog(trx, {
          tenantId: request.auth!.tenantId,
          branchId: updatedSale.branch_id,
          userId: request.auth!.userId,
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
              tenant_id: request.auth!.tenantId,
              type: 'SALE_VOIDED',
              aggregate_id: updatedSale.id,
              payload_json: {
                sale_id: updatedSale.id,
                tenant_id: request.auth!.tenantId,
                branch_id: updatedSale.branch_id,
                invoice_dian_document_id: dianDocument.id,
                sale_number: updatedSale.sale_number,
                total_cents: updatedSale.total_cents,
                void_reason: updatedSale.void_reason
              },
              status: 'PENDING',
              attempts: 0,
              next_retry_at: null
            })
            .execute();
        }

        return mapSaleRow(updatedSale);
=======
      const voidedSale = await voidSaleService({
        db: app.db,
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        saleId: params.id,
        payload
>>>>>>> aa2b4ca (refactor)
      });

      request.log.info(
        {
          ...buildRequestLogContext(request, {
            branchId: voidedSale.branch_id,
            saleId: voidedSale.id
          }),
          event: 'sale_voided',
          sale_number: voidedSale.sale_number,
          total_cents: voidedSale.total_cents,
          void_reason: voidedSale.void_reason,
          voided_at: voidedSale.voided_at
        },
        'Sale voided'
      );

      return {
        sale: voidedSale
      };
    }
  );

  typedApp.post(
    '/sales/:id/returns',
    {
      preHandler: [app.requireRoles(['ADMIN', 'MANAGER'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        params: saleIdParamsSchema,
        body: CreateReturnRequestSchema
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const params = saleIdParamsSchema.parse(request.params);
      const payload = CreateReturnRequestSchema.parse(request.body);

      const result = await processPartialReturn(
        {
          db: app.db,
          tenantId: request.auth.tenantId,
          userId: request.auth.userId,
          branchId: '00000000-0000-0000-0000-000000000000' // It will be looked up inside
        },
        params.id,
        payload
      );

      request.log.info(
        {
          ...buildRequestLogContext(request, {
            saleId: params.id
          }),
          event: 'sale_returned',
          return_id: result.return_id,
          total_refund_cents: result.total_refund_cents
        },
        'Sale returned'
      );

      return result;
    }
  );
};
