import { randomUUID } from 'node:crypto';
import { sql, type Insertable } from 'kysely';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../infra/errors/app-error.js';
import type { Database } from '../infra/db/schema.js';
import {
  createSaleBodySchema,
  saleIdParamsSchema,
  salesListQuerySchema,
  voidSaleBodySchema
} from '../modules/sales/schemas.js';
import { normalizeSalePayments } from '../modules/sales/payments.js';
import {
  getNextSaleNumberForBranchInTransaction,
  isSaleNumberUniqueConstraintError
} from '../domain/sale-numbering-service.js';
import { computeTaxes, type ComputeTaxesLineInput } from '../domain/tax/index.js';
import { writeAuditLog } from '../domain/audit/write-audit-log.js';
import { buildRequestLogContext } from '../infra/logging/request-log-context.js';

const DIAN_PROVIDER = process.env.DIAN_PROVIDER ?? 'mock';

interface SaleInsertItem {
  id: string;
  tenant_id: string;
  sale_id: string;
  product_id: string;
  qty: string;
  price_cents: number;
  line_total_cents: number;
}

const saleColumnList = [
  'id',
  'tenant_id',
  'branch_id',
  'cash_session_id',
  'sale_number',
  'status',
  'subtotal_cents',
  'discount_cents',
  'total_cents',
  'tax_total_cents',
  'tax_lines_json',
  'payment_json',
  'created_by_user_id',
  'void_reason',
  'voided_by_user_id',
  'voided_at',
  'created_at'
] as const;

function parseSaleNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return 0;
}

function serializeJsonArrayForDb(
  value: ReadonlyArray<unknown>
): Insertable<Database['sales']>['tax_lines_json'] {
  // pg serializes JS arrays as PostgreSQL arrays, not JSON. We stringify before insert.
  return JSON.stringify(value) as unknown as Insertable<Database['sales']>['tax_lines_json'];
}

function mapSaleRow(row: {
  id: string;
  tenant_id: string;
  branch_id: string;
  cash_session_id: string;
  sale_number: number;
  status: 'COMPLETED' | 'VOID';
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  tax_total_cents: number;
  tax_lines_json: unknown;
  payment_json: unknown;
  created_by_user_id: string;
  void_reason: string | null;
  voided_by_user_id: string | null;
  voided_at: Date | null;
  created_at: Date;
  dian_status?: 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | null;
}) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    branch_id: row.branch_id,
    cash_session_id: row.cash_session_id,
    sale_number: parseSaleNumber(row.sale_number),
    status: row.status,
    subtotal_cents: row.subtotal_cents,
    discount_cents: row.discount_cents,
    total_cents: row.total_cents,
    tax_total_cents: row.tax_total_cents,
    tax_lines_json: row.tax_lines_json,
    payment_json: row.payment_json,
    dian_status: row.dian_status ?? null,
    created_by_user_id: row.created_by_user_id,
    void_reason: row.void_reason ?? null,
    voided_by_user_id: row.voided_by_user_id ?? null,
    voided_at: row.voided_at ? row.voided_at.toISOString() : null,
    created_at: row.created_at.toISOString()
  };
}

export const salesRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  async function loadExistingSaleByClientUuid(tenantId: string, clientUuid: string) {
    const existingSale = await app.db
      .selectFrom('sales')
      .select([...saleColumnList])
      .where('tenant_id', '=', tenantId)
      .where('client_uuid', '=', clientUuid)
      .executeTakeFirst();

    if (!existingSale) {
      return null;
    }

    const saleItems = await app.db
      .selectFrom('sale_items')
      .select(['id', 'product_id', 'qty', 'price_cents', 'line_total_cents'])
      .where('tenant_id', '=', tenantId)
      .where('sale_id', '=', existingSale.id)
      .orderBy('id', 'asc')
      .execute();

    return {
      sale: mapSaleRow(existingSale),
      items: saleItems.map((item) => ({
        id: item.id,
        product_id: item.product_id,
        qty: Number(item.qty),
        price_cents: item.price_cents,
        line_total_cents: item.line_total_cents
      }))
    };
  }

  typedApp.post(
    '/sales',
    {
      preHandler: [app.requireRoles(['ADMIN', 'CASHIER'])],
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
      const existingSale = await loadExistingSaleByClientUuid(
        request.auth.tenantId,
        payload.client_uuid
      );
      if (existingSale) {
        request.log.info(
          {
            ...buildRequestLogContext(request, {
              branchId: existingSale.sale.branch_id,
              saleId: existingSale.sale.id
            }),
            event: 'sale_idempotency_hit',
            client_uuid: payload.client_uuid,
            sale_number: existingSale.sale.sale_number
          },
          'Sale already exists for client_uuid'
        );
        return reply.code(200).send(existingSale);
      }

      const normalizedPayments = normalizeSalePayments(payload.payments);

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

          await trx
            .insertInto('dian_documents')
            .values({
              id: randomUUID(),
              tenant_id: request.auth!.tenantId,
              sale_id: saleId,
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
      }

      request.log.info(
        {
          ...buildRequestLogContext(request, {
            branchId: payload.branch_id,
            saleId: createdSale.sale.id
          }),
          event: 'sale_created',
          client_uuid: payload.client_uuid,
          sale_number: createdSale.sale.sale_number,
          cash_session_id: payload.cash_session_id,
          items_count: createdSale.items.length,
          subtotal_cents: createdSale.sale.subtotal_cents,
          discount_cents: createdSale.sale.discount_cents,
          tax_total_cents: createdSale.sale.tax_total_cents,
          total_cents: createdSale.sale.total_cents,
          payment_mode: normalizedPayments.mode
        },
        'Sale created'
      );

      return reply.code(201).send(createdSale);
    }
  );

  typedApp.get(
    '/sales',
    {
      preHandler: [app.requireRoles(['ADMIN', 'CASHIER'])],
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
      preHandler: [app.requireRoles(['ADMIN', 'CASHIER'])],
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
        .select([
          'sale_items.id',
          'sale_items.product_id',
          'sale_items.qty',
          'sale_items.price_cents',
          'sale_items.line_total_cents',
          'products.name as product_name',
          'products.image_url as product_image_url',
          'products.description as product_description'
        ])
        .where('sale_items.tenant_id', '=', request.auth.tenantId)
        .where('sale_items.sale_id', '=', sale.id)
        .orderBy('sale_items.id', 'asc')
        .execute();

      const dianDocument = await app.db
        .selectFrom('dian_documents')
        .select(['id', 'provider', 'status', 'cude', 'created_at', 'updated_at'])
        .where('tenant_id', '=', request.auth.tenantId)
        .where('sale_id', '=', sale.id)
        .executeTakeFirst();

      return {
        sale: mapSaleRow(sale),
        items: saleItems.map((item) => ({
          id: item.id,
          product_id: item.product_id,
          product_name: item.product_name,
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
      preHandler: [app.requireRoles(['ADMIN'])],
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
};
