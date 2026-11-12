import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import {
  createSaleBodySchema,
  saleIdParamsSchema,
  salesListQuerySchema,
  voidSaleBodySchema
} from '../services/schemas.js';
import { buildRequestLogContext } from '../../../shared/infra/logging/request-log-context.js';
import { mapSaleRow, saleColumnList } from '../services/sale-mapper.js';
import { CreateSaleCommand } from '../application/CreateSaleCommand.js';
import { CreateSaleHandler } from '../application/CreateSaleHandler.js';
import { voidSaleService } from '../services/void-sale.service.js';
import { processPartialReturn } from '../services/create-return.service.js';
import {
  CreateReturnRequestSchema,
  createdSaleResponseSchema,
  dianDocumentTypeSchema,
  saleDetailResponseSchema,
  salesListResponseSchema,
  voidSaleResponseSchema
} from '@pos-dian/shared';
import { ensureUserCanAccessBranch } from '../../../shared/infra/security/permissions.js';


export const salesRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // POST /sales — create a new sale
  typedApp.post(
    '/sales',
    {
      preHandler: [app.requirePermissions(['sales:create'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        body: createSaleBodySchema,
        /**
         * Declarar la respuesta no es solo documentar.
         *
         * Fastify serializa a través de este esquema y recorta lo que no esté en él. Sin
         * declararlo, lo que el handler seleccione de más sale por el cable, y de esta
         * ruta sale el consecutivo de una venta: es el sitio donde menos gracia hace
         * enterarse tarde. De paso, es lo que permite que el tipo del frontend salga del
         * contrato en vez de escribirse a mano.
         */
        response: { 200: createdSaleResponseSchema, 201: createdSaleResponseSchema }
      }
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const payload = createSaleBodySchema.parse(request.body);
      ensureUserCanAccessBranch(request.auth, payload.branch_id);

      const command = new CreateSaleCommand(
        payload,
        request.auth!.tenantId!,
        request.auth.userId,
        request.auth.role,
        request.log,
        buildRequestLogContext(request, {})
      );

      const handler = new CreateSaleHandler(app.db);
      const result = await handler.handle(command);

      if (result.isIdempotentHit) {
        return reply.code(200).send(result.sale);
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

      if (payload.table_order_id && request.user?.enableKitchenDisplay) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (request.server as any).io?.to(`branch:${payload.branch_id}`).emit('KITCHEN_TICKETS_UPDATED');
      }

      return reply.code(201).send(result.sale);
    }
  );

  // GET /sales — list sales
  typedApp.get(
    '/sales',
    {
      preHandler: [app.requirePermissions(['sales:view'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        querystring: salesListQuerySchema,
        response: { 200: salesListResponseSchema }
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const query = salesListQuerySchema.parse(request.query);
      const { branch_id: branchId, from, to, limit } = query;

      ensureUserCanAccessBranch(request.auth, branchId);

      const rows = await request.executeAsTenant(async (trx) => {
        let queryBuilder = trx
          .selectFrom('sales')
          .leftJoin('dian_documents', (join) =>
            join
              .onRef('dian_documents.sale_id', '=', 'sales.id')
              .onRef('dian_documents.tenant_id', '=', 'sales.tenant_id')
              .on('dian_documents.document_type', '=', 'INVOICE')
          )
          .selectAll('sales')
          .select('dian_documents.status as dian_status')
          // Optional now, but kept for clarity and explicit filtering
          .where('sales.tenant_id', '=', request.auth!.tenantId!)
          .where('sales.branch_id', '=', branchId);

        if (from) {
          queryBuilder = queryBuilder.where('sales.created_at', '>=', from);
        }

        if (to) {
          queryBuilder = queryBuilder.where('sales.created_at', '<=', to);
        }

        return await queryBuilder
          .orderBy('sales.created_at', 'desc')
          .orderBy('sales.id', 'desc')
          .limit(limit + 1)
          .execute();
      });

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

  // GET /sales/:id — get sale detail
  typedApp.get(
    '/sales/:id',
    {
      preHandler: [app.requirePermissions(['sales:view'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        params: saleIdParamsSchema,
        response: { 200: saleDetailResponseSchema }
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const params = saleIdParamsSchema.parse(request.params);

      const result = await request.executeAsTenant(async (trx) => {
        const sale = await trx
          .selectFrom('sales')
          .select([...saleColumnList])
          .where('tenant_id', '=', request.auth!.tenantId!)
          .where('id', '=', params.id)
          .executeTakeFirst();

        if (!sale) {
          throw new AppError(404, 'SALE_NOT_FOUND', 'Venta no encontrada');
        }

        ensureUserCanAccessBranch(request.auth!, sale.branch_id);

        const saleItems = await trx
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
            /**
             * Los dos nombres, y el congelado manda.
             *
             * `sale_items.product_name` es el nombre con el que se vendió; `products.name`
             * es el que tiene el catálogo **ahora**. Antes solo existía el segundo, así que
             * renombrar un producto reescribía el tiquete de una venta vieja.
             *
             * El del catálogo se sigue trayendo porque las ventas anteriores a la migración
             * 111 tienen la columna en `null` y no hay forma de reconstruir el nombre real:
             * para esas, el de hoy es lo mejor que hay. Para todo lo posterior no se mira.
             */
            'sale_items.product_name as product_name_congelado',
            'products.name as product_name',
            'product_variants.name as variant_name',
            'products.image_url as product_image_url',
            'products.description as product_description'
          ])
          .where('sale_items.tenant_id', '=', request.auth!.tenantId!)
          .where('sale_items.sale_id', '=', sale.id)
          .orderBy('sale_items.id', 'asc')
          .execute();

        const dianDocument = await trx
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
          .where('tenant_id', '=', request.auth!.tenantId!)
          .where('sale_id', '=', sale.id)
          .where('document_type', '=', 'INVOICE')
          .executeTakeFirst();

        return { sale, saleItems, dianDocument };
      });

      const { sale, saleItems, dianDocument } = result;

      return {
        sale: mapSaleRow(sale),
        items: saleItems.map((item) => ({
          id: item.id,
          product_id: item.product_id,
          variant_id: item.variant_id,
          /**
           * Manda el nombre congelado en la venta; el del catálogo es solo el respaldo.
           *
           * Ese orden es el arreglo de la fase 13. Antes solo existía el del catálogo, que
           * se resolvía con un `leftJoin` **en el momento de mirar la venta**: renombrar un
           * producto reescribía el tiquete de una venta del mes pasado, y borrarlo dejaba
           * un nulo que se imprimía como «null» en una línea ya cobrada.
           *
           * Las tres ramas dicen cosas distintas y por eso están las tres:
           *   1. Hay nombre congelado → es el de la venta. Punto.
           *   2. No lo hay (venta anterior a la migración 111) → el del catálogo, que es lo
           *      mejor disponible aunque pueda haber cambiado.
           *   3. Tampoco hay catálogo (producto borrado) → un texto honesto, nunca «null».
           */
          product_name:
            item.product_name_congelado ?? item.product_name ?? 'Producto no disponible',
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
            // La columna es `text` y el contrato promete un tipo de documento DIAN. La
            // consulta ya filtra por 'INVOICE', así que en la práctica coinciden; se
            // valida igualmente para que sea el contrato, y no una cláusula `where` a
            // diez líneas de distancia, lo que sostiene la promesa.
            document_type: dianDocumentTypeSchema.safeParse(dianDocument.document_type).data,
            parent_document_id: dianDocument.parent_document_id,
            created_at: dianDocument.created_at.toISOString(),
            updated_at: dianDocument.updated_at.toISOString()
          }
          : null
      };
    }
  );

  // POST /sales/:id/void — void a sale
  typedApp.post(
    '/sales/:id/void',
    {
      preHandler: [app.requirePermissions(['sales:void'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        params: saleIdParamsSchema,
        body: voidSaleBodySchema,
        response: { 200: voidSaleResponseSchema }
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const params = saleIdParamsSchema.parse(request.params);
      const payload = voidSaleBodySchema.parse(request.body);

      const voidedSale = await voidSaleService({
        db: app.db,
        tenantId: request.auth!.tenantId!,
        auth: request.auth,
        saleId: params.id,
        payload
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

      return { sale: voidedSale };
    }
  );

  // POST /sales/:id/returns — partial return
  typedApp.post(
    '/sales/:id/returns',
    {
      preHandler: [app.requirePermissions(['returns:create'])],
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
          tenantId: request.auth!.tenantId!,
          auth: request.auth
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
