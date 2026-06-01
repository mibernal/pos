import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import {
  branchHeaderSchema,
  createProductBodySchema,
  patchProductBodySchema,
  patchProductParamsSchema,
  productsQuerySchema
} from '../services/products/schemas.js';
import {
  buildSearchPattern,
  canAccessProductInBranchScope,
  normalizeBranchHeader,
  resolveBranchIdForCreate,
  resolveBranchIdForPatch
} from '../services/products/scope.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';
import { ensureUserCanAccessBranch } from '../../../shared/infra/security/permissions.js';

async function ensureBranchBelongsToTenant(
  db: FastifyInstance['db'],
  tenantId: string,
  branchId: string
): Promise<void> {
  const branch = await db
    .selectFrom('branches')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', branchId)
    .executeTakeFirst();

  if (!branch) {
    throw new AppError(400, 'BRANCH_NOT_FOUND', 'La sucursal no existe para este tenant');
  }
}

export const productsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/products',
    {
      preHandler: [app.requirePermissions(['products:view'])],
      schema: {
        tags: ['products'],
        security: [{ bearerAuth: [] }],
        headers: branchHeaderSchema,
        querystring: productsQuerySchema
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const { query, limit } = productsQuerySchema.parse(request.query);
      const headers = branchHeaderSchema.parse(request.headers);
      const branchId = normalizeBranchHeader(headers['x-branch-id']);
      const searchPattern = buildSearchPattern(query);

      let queryBuilder = app.db
        .selectFrom('products')
        .select([
          'id',
          'tenant_id',
          'branch_id',
          'name',
          'category',
          'tax_category',
          'barcode',
          'price_cents',
          'active',
          'image_url',
          'description',
          'created_at',
          'updated_at'
        ])
        .where('tenant_id', '=', request.auth.tenantId);

      if (branchId) {
        queryBuilder = queryBuilder.where(
          sql<boolean>`(products.branch_id = ${branchId} OR products.branch_id IS NULL)`
        );
      }

      if (searchPattern) {
        queryBuilder = queryBuilder.where(
          sql<boolean>`(products.name ILIKE ${searchPattern} OR products.barcode ILIKE ${searchPattern})`
        );
      }

      const rows = await queryBuilder.orderBy('name', 'asc').orderBy('id', 'asc').limit(limit + 1).execute();

      const hasMore = rows.length > limit;
      const productRows = rows.slice(0, limit);

      const variantsByProductId: Record<string, Array<{ id: string; name: string; price_cents: number; barcode: string | null }>> = {};
      const promotionsByProductId: Record<string, { type: string; value_cents: number; buy_qty: number | null; get_qty: number | null }> = {};
      
      if (productRows.length > 0) {
        const productIds = productRows.map(r => r.id);
        
        const variants = await app.db
          .selectFrom('product_variants')
          .select(['id', 'product_id', 'name', 'price_cents', 'barcode', 'active'])
          .where('product_id', 'in', productIds)
          .where('active', '=', true)
          .execute();
          
        variants.forEach(v => {
          if (!variantsByProductId[v.product_id]) {
            variantsByProductId[v.product_id] = [];
          }
          variantsByProductId[v.product_id]!.push({
            id: v.id,
            name: v.name,
            price_cents: v.price_cents,
            barcode: v.barcode
          });
        });

        const activePromotions = await app.db
          .selectFrom('promotions')
          .selectAll()
          .where('product_id', 'in', productIds)
          .where('tenant_id', '=', request.auth.tenantId)
          .where('active', '=', true)
          .where('start_date', '<=', sql<Date>`NOW()`)
          .where(sql<boolean>`(end_date IS NULL OR end_date >= NOW())`)
          .execute();
          
        activePromotions.forEach(promo => {
          if (!promotionsByProductId[promo.product_id]) {
            promotionsByProductId[promo.product_id] = {
              type: promo.type,
              value_cents: promo.value_cents,
              buy_qty: promo.buy_qty,
              get_qty: promo.get_qty
            };
          }
        });
      }

      const items = productRows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        branchId: row.branch_id,
        name: row.name,
        category: row.category,
        taxCategory: row.tax_category,
        barcode: row.barcode,
        price_cents: row.price_cents,
        active: row.active,
        imageUrl: row.image_url,
        description: row.description,
        variants: variantsByProductId[row.id] || [],
        promotion: promotionsByProductId[row.id] || null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      }));

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

  typedApp.post(
    '/products',
    {
      preHandler: [app.requirePermissions(['products:manage'])],
      schema: {
        tags: ['products'],
        security: [{ bearerAuth: [] }],
        headers: branchHeaderSchema,
        body: createProductBodySchema
      }
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const headers = branchHeaderSchema.parse(request.headers);
      const branchIdFromHeader = normalizeBranchHeader(headers['x-branch-id']);
      const payload = createProductBodySchema.parse(request.body);

      const resolvedBranchId = resolveBranchIdForCreate(branchIdFromHeader, payload.branchId);

      if (resolvedBranchId) {
        await ensureBranchBelongsToTenant(app.db, request.auth.tenantId, resolvedBranchId);
        ensureUserCanAccessBranch(request.auth, resolvedBranchId);
      }

      const createdProduct = await app.db
        .insertInto('products')
        .values({
          id: randomUUID(),
          tenant_id: request.auth.tenantId,
          branch_id: resolvedBranchId,
          name: payload.name,
          category: payload.category,
          tax_category: payload.taxCategory,
          barcode: payload.barcode ?? null,
          price_cents: payload.price_cents,
          cost_cents: 0,
          active: payload.active,
          image_url: payload.imageUrl ?? null,
          description: payload.description ?? null
        })
        .returning([
          'id',
          'tenant_id',
          'branch_id',
          'name',
          'category',
          'tax_category',
          'barcode',
          'price_cents',
          'active',
          'image_url',
          'description',
          'created_at',
          'updated_at'
        ])
        .executeTakeFirstOrThrow();

      return reply.code(201).send({
        id: createdProduct.id,
        tenantId: createdProduct.tenant_id,
        branchId: createdProduct.branch_id,
        name: createdProduct.name,
        category: createdProduct.category,
        taxCategory: createdProduct.tax_category,
        barcode: createdProduct.barcode,
        price_cents: createdProduct.price_cents,
        active: createdProduct.active,
        imageUrl: createdProduct.image_url,
        description: createdProduct.description,
        createdAt: createdProduct.created_at.toISOString(),
        updatedAt: createdProduct.updated_at.toISOString()
      });
    }
  );

  typedApp.patch(
    '/products/:id',
    {
      preHandler: [app.requirePermissions(['products:manage'])],
      schema: {
        tags: ['products'],
        security: [{ bearerAuth: [] }],
        headers: branchHeaderSchema,
        params: patchProductParamsSchema,
        body: patchProductBodySchema
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const headers = branchHeaderSchema.parse(request.headers);
      const params = patchProductParamsSchema.parse(request.params);
      const payload = patchProductBodySchema.parse(request.body);
      const branchIdFromHeader = normalizeBranchHeader(headers['x-branch-id']);
      if (Object.keys(payload).length === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Debes enviar al menos un campo');
      }

      const updatedProduct = await app.db.transaction().execute(async (trx) => {
        const currentProduct = await trx
          .selectFrom('products')
          .select([
            'id',
            'tenant_id',
            'branch_id',
            'name',
            'category',
            'tax_category',
            'barcode',
            'price_cents',
            'active',
            'image_url',
            'description',
            'created_at',
            'updated_at'
          ])
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('id', '=', params.id)
          .forUpdate()
          .executeTakeFirst();

        if (
          !currentProduct ||
          !canAccessProductInBranchScope(currentProduct.branch_id, branchIdFromHeader)
        ) {
          throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
        }

        const resolvedBranchId = resolveBranchIdForPatch(
          branchIdFromHeader,
          payload.branchId,
          currentProduct.branch_id
        );

        if (resolvedBranchId) {
          await ensureBranchBelongsToTenant(trx, request.auth!.tenantId, resolvedBranchId);
          ensureUserCanAccessBranch(request.auth, resolvedBranchId);
        }

        const nextProduct = await trx
          .updateTable('products')
          .set({
            ...(payload.name !== undefined ? { name: payload.name } : {}),
            ...(payload.category !== undefined ? { category: payload.category } : {}),
            ...(payload.taxCategory !== undefined ? { tax_category: payload.taxCategory } : {}),
            ...(payload.barcode !== undefined ? { barcode: payload.barcode } : {}),
            ...(payload.price_cents !== undefined ? { price_cents: payload.price_cents } : {}),
            ...(payload.imageUrl !== undefined ? { image_url: payload.imageUrl } : {}),
            ...(payload.description !== undefined ? { description: payload.description } : {}),
            branch_id: resolvedBranchId
          })
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('id', '=', params.id)
          .returning([
            'id',
            'tenant_id',
            'branch_id',
            'name',
            'category',
            'tax_category',
            'barcode',
            'price_cents',
            'active',
            'image_url',
            'description',
            'created_at',
            'updated_at'
          ])
          .executeTakeFirstOrThrow();

        await writeAuditLog(trx, {
          tenantId: request.auth!.tenantId,
          branchId: nextProduct.branch_id,
          userId: request.auth!.userId,
          entityType: 'PRODUCT',
          entityId: nextProduct.id,
          action: 'PRODUCT_UPDATED',
          payloadJson: {
            request: payload,
            previous: {
              branch_id: currentProduct.branch_id,
              name: currentProduct.name,
              category: currentProduct.category,
              tax_category: currentProduct.tax_category,
              barcode: currentProduct.barcode,
              price_cents: currentProduct.price_cents,
              image_url: currentProduct.image_url,
              description: currentProduct.description
            },
            next: {
              branch_id: nextProduct.branch_id,
              name: nextProduct.name,
              category: nextProduct.category,
              tax_category: nextProduct.tax_category,
              barcode: nextProduct.barcode,
              price_cents: nextProduct.price_cents,
              image_url: nextProduct.image_url,
              description: nextProduct.description
            }
          }
        });

        if (currentProduct.tax_category !== nextProduct.tax_category) {
          await writeAuditLog(trx, {
            tenantId: request.auth!.tenantId,
            branchId: nextProduct.branch_id,
            userId: request.auth!.userId,
            entityType: 'PRODUCT',
            entityId: nextProduct.id,
            action: 'PRODUCT_TAX_CATEGORY_UPDATED',
            payloadJson: {
              previous_tax_category: currentProduct.tax_category,
              new_tax_category: nextProduct.tax_category
            }
          });
        }

        return nextProduct;
      });

      return {
        id: updatedProduct.id,
        tenantId: updatedProduct.tenant_id,
        branchId: updatedProduct.branch_id,
        name: updatedProduct.name,
        category: updatedProduct.category,
        taxCategory: updatedProduct.tax_category,
        barcode: updatedProduct.barcode,
        price_cents: updatedProduct.price_cents,
        active: updatedProduct.active,
        imageUrl: updatedProduct.image_url,
        description: updatedProduct.description,
        createdAt: updatedProduct.created_at.toISOString(),
        updatedAt: updatedProduct.updated_at.toISOString()
      };
    }
  );

  typedApp.post(
    '/products/:id/toggle-active',
    {
      preHandler: [app.requirePermissions(['products:manage'])],
      schema: {
        tags: ['products'],
        security: [{ bearerAuth: [] }],
        headers: branchHeaderSchema,
        params: patchProductParamsSchema
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const headers = branchHeaderSchema.parse(request.headers);
      const params = patchProductParamsSchema.parse(request.params);
      const branchIdFromHeader = normalizeBranchHeader(headers['x-branch-id']);

      const currentProduct = await app.db
        .selectFrom('products')
        .select(['id', 'tenant_id', 'branch_id', 'active'])
        .where('tenant_id', '=', request.auth.tenantId)
        .where('id', '=', params.id)
        .executeTakeFirst();

      if (!currentProduct || !canAccessProductInBranchScope(currentProduct.branch_id, branchIdFromHeader)) {
        throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
      }

      if (currentProduct.branch_id) {
        ensureUserCanAccessBranch(request.auth, currentProduct.branch_id);
      }

      const updatedProduct = await app.db
        .updateTable('products')
        .set({
          active: !currentProduct.active
        })
        .where('tenant_id', '=', request.auth.tenantId)
        .where('id', '=', params.id)
        .returning([
          'id',
          'tenant_id',
          'branch_id',
          'name',
          'category',
          'tax_category',
          'barcode',
          'price_cents',
          'active',
          'image_url',
          'description',
          'created_at',
          'updated_at'
        ])
        .executeTakeFirstOrThrow();

      return {
        id: updatedProduct.id,
        tenantId: updatedProduct.tenant_id,
        branchId: updatedProduct.branch_id,
        name: updatedProduct.name,
        category: updatedProduct.category,
        taxCategory: updatedProduct.tax_category,
        barcode: updatedProduct.barcode,
        price_cents: updatedProduct.price_cents,
        active: updatedProduct.active,
        imageUrl: updatedProduct.image_url,
        description: updatedProduct.description,
        createdAt: updatedProduct.created_at.toISOString(),
        updatedAt: updatedProduct.updated_at.toISOString()
      };
    }
  );
};
