import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { 
  createPromotionSchema, 
  updatePromotionSchema, 
  listPromotionsQuerySchema 
} from '@pos-dian/shared';

import { AppError } from '../../../shared/infra/errors/app-error.js';

export const promotionsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/promotions',
    {
      preHandler: [app.requirePermissions(['products:view'])],
      schema: {
        tags: ['promotions'],
        security: [{ bearerAuth: [] }],
        querystring: listPromotionsQuerySchema
      }
    },
    async (request) => {
      if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'No autorizado');
      const { product_id, active } = request.query;

      let query = app.db
        .selectFrom('promotions')
        .where('tenant_id', '=', request.auth!.tenantId!);

      if (product_id) {
        query = query.where('product_id', '=', product_id);
      }
      
      if (active !== undefined) {
        query = query.where('active', '=', active);
      }

      const rows = await query
        .selectAll()
        .orderBy('created_at', 'desc')
        .execute();

      return {
        items: rows.map(r => ({
          ...r,
          start_date: r.start_date.toISOString(),
          end_date: r.end_date?.toISOString() ?? null,
          created_at: r.created_at.toISOString(),
          updated_at: r.updated_at.toISOString(),
        }))
      };
    }
  );

  typedApp.post(
    '/promotions',
    {
      preHandler: [app.requirePermissions(['products:manage'])],
      schema: {
        tags: ['promotions'],
        security: [{ bearerAuth: [] }],
        body: createPromotionSchema
      }
    },
    async (request, reply) => {
      if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'No autorizado');
      
      const payload = request.body;

      // Verify product exists and belongs to tenant
      const product = await app.db
        .selectFrom('products')
        .select('id')
        .where('id', '=', payload.product_id)
        .where('tenant_id', '=', request.auth!.tenantId!)
        .executeTakeFirst();
        
      if (!product) {
        throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
      }

      const id = randomUUID();

      const newPromo = await app.db
        .insertInto('promotions')
        .values({
          id,
          tenant_id: request.auth!.tenantId!,
          product_id: payload.product_id,
          type: payload.type,
          value_cents: payload.value_cents,
          buy_qty: payload.buy_qty ?? null,
          get_qty: payload.get_qty ?? null,
          start_date: new Date(payload.start_date),
          end_date: payload.end_date ? new Date(payload.end_date) : null,
          active: payload.active
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return reply.code(201).send({
        ...newPromo,
        start_date: newPromo.start_date.toISOString(),
        end_date: newPromo.end_date?.toISOString() ?? null,
        created_at: newPromo.created_at.toISOString(),
        updated_at: newPromo.updated_at.toISOString(),
      });
    }
  );

  typedApp.patch(
    '/promotions/:id',
    {
      preHandler: [app.requirePermissions(['products:manage'])],
      schema: {
        tags: ['promotions'],
        security: [{ bearerAuth: [] }],
        body: updatePromotionSchema
      }
    },
    async (request) => {
      if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'No autorizado');
      
      const { id } = request.params as { id: string };
      const payload = request.body;

      if (Object.keys(payload).length === 0) {
        throw new AppError(400, 'BAD_REQUEST', 'Nada para actualizar');
      }

      const values: any = { ...payload, updated_at: new Date() }; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (payload.start_date) values.start_date = new Date(payload.start_date);
      if (payload.end_date !== undefined) values.end_date = payload.end_date ? new Date(payload.end_date) : null;

      const updated = await app.db
        .updateTable('promotions')
        .set(values)
        .where('id', '=', id)
        .where('tenant_id', '=', request.auth!.tenantId!)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new AppError(404, 'PROMOTION_NOT_FOUND', 'Promoción no encontrada');
      }

      return {
        ...updated,
        start_date: updated.start_date.toISOString(),
        end_date: updated.end_date?.toISOString() ?? null,
        created_at: updated.created_at.toISOString(),
        updated_at: updated.updated_at.toISOString(),
      };
    }
  );

  typedApp.delete(
    '/promotions/:id',
    {
      preHandler: [app.requirePermissions(['products:manage'])],
      schema: {
        tags: ['promotions'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request, reply) => {
      if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'No autorizado');
      
      const { id } = request.params as { id: string };

      // Soft delete: set active = false
      const deactivated = await app.db
        .updateTable('promotions')
        .set({ active: false, updated_at: new Date() })
        .where('id', '=', id)
        .where('tenant_id', '=', request.auth!.tenantId!)
        .returningAll()
        .executeTakeFirst();

      if (!deactivated) {
        throw new AppError(404, 'PROMOTION_NOT_FOUND', 'Promoción no encontrada');
      }

      return reply.code(200).send({ success: true });
    }
  );
};
