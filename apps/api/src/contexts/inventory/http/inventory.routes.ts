import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import {
  createInventoryTransactionBodySchema,
  inventoryBalancesQuerySchema,
  consolidatedInventoryResponseSchema
} from '@pos-dian/shared';
import { ensureUserCanAccessBranch } from '../../identity/auth/permissions.js';

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  async function ensureBranchBelongsToTenant(tenantId: string, branchId: string): Promise<void> {
    const branch = await app.db
      .selectFrom('branches')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', branchId)
      .executeTakeFirst();

    if (!branch) {
      throw new AppError(404, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada para este tenant');
    }
  }

  typedApp.get(
    '/inventory/balances',
    {
      preHandler: [app.requirePermissions(['reports:view'])],
      schema: {
        tags: ['inventory'],
        security: [{ bearerAuth: [] }],
        querystring: inventoryBalancesQuerySchema
      }
    },
    async (request) => {
      const { branch_id, product_id } = request.query;
      await ensureBranchBelongsToTenant(request.auth!.tenantId, branch_id);
      ensureUserCanAccessBranch(request.auth, branch_id);

      let query = app.db
        .selectFrom('inventory_balances as b')
        .innerJoin('products as p', (join) =>
          join
            .onRef('p.id', '=', 'b.product_id')
            .onRef('p.tenant_id', '=', 'b.tenant_id')
        )
        .select([
          'b.tenant_id',
          'b.branch_id',
          'b.product_id',
          'b.qty',
          'b.updated_at',
          'p.name as product_name',
          'p.image_url'
        ])
        .where('b.tenant_id', '=', request.auth!.tenantId)
        .where('b.branch_id', '=', branch_id);

      if (product_id) {
        query = query.where('b.product_id', '=', product_id);
      }

      const rows = await query.orderBy('p.name', 'asc').execute();

      return rows.map((row) => ({
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        product_id: row.product_id,
        qty: Number(row.qty),
        updated_at: row.updated_at.toISOString(),
        product_name: row.product_name,
        image_url: row.image_url
      }));
    }
  );

  typedApp.get(
    '/inventory/consolidated',
    {
      preHandler: [app.requirePermissions(['reports:view'])],
      schema: {
        tags: ['inventory'],
        security: [{ bearerAuth: [] }],
        response: {
          200: consolidatedInventoryResponseSchema
        }
      }
    },
    async (request) => {
      const rows = await app.db
        .selectFrom('inventory_balances as b')
        .innerJoin('products as p', (join) =>
          join
            .onRef('p.id', '=', 'b.product_id')
            .onRef('p.tenant_id', '=', 'b.tenant_id')
        )
        .innerJoin('branches as br', (join) =>
          join
            .onRef('br.id', '=', 'b.branch_id')
            .onRef('br.tenant_id', '=', 'b.tenant_id')
        )
        .select([
          'b.product_id',
          'p.name as product_name',
          'p.category',
          'p.image_url',
          sql<number>`sum(b.qty)`.as('total_qty'),
          sql<{ branch_id: string; branch_name: string; qty: number }[]>`json_agg(json_build_object(
            'branch_id', br.id,
            'branch_name', br.name,
            'qty', b.qty
          ))`.as('branches_breakdown')
        ])
        .where('b.tenant_id', '=', request.auth!.tenantId)
        .groupBy(['b.product_id', 'p.name', 'p.category', 'p.image_url'])
        .orderBy('p.name', 'asc')
        .execute();

      return rows.map((row) => ({
        product_id: row.product_id,
        product_name: row.product_name,
        category: row.category,
        image_url: row.image_url,
        total_qty: Number(row.total_qty),
        branches_breakdown: row.branches_breakdown
      }));
    }
  );

  typedApp.post(
    '/inventory/transactions',
    {
      preHandler: [app.requirePermissions(['inventory:adjust'])],
      schema: {
        tags: ['inventory'],
        security: [{ bearerAuth: [] }],
        body: createInventoryTransactionBodySchema
      }
    },
    async (request, reply) => {
      const payload = request.body;
      await ensureBranchBelongsToTenant(request.auth!.tenantId, payload.branch_id);
      ensureUserCanAccessBranch(request.auth, payload.branch_id);

      const product = await app.db
        .selectFrom('products')
        .select(['id', 'branch_id'])
        .where('tenant_id', '=', request.auth!.tenantId)
        .where('id', '=', payload.product_id)
        .executeTakeFirst();

      if (!product || (product.branch_id && product.branch_id !== payload.branch_id)) {
        throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado en esta sucursal');
      }

      await app.db.transaction().execute(async (trx) => {
        const txId = randomUUID();
        await trx
          .insertInto('inventory_transactions')
          .values({
            id: txId,
            tenant_id: request.auth!.tenantId,
            branch_id: payload.branch_id,
            product_id: payload.product_id,
            operation: payload.operation,
            reference_id: null,
            qty_change: payload.qty_change.toString(),
            notes: payload.notes ?? null,
            created_by_user_id: request.auth!.userId
          })
          .execute();

        await trx
          .insertInto('inventory_balances')
          .values({
            tenant_id: request.auth!.tenantId,
            branch_id: payload.branch_id,
            product_id: payload.product_id,
            qty: payload.qty_change.toString()
          })
          .onConflict((oc) =>
            oc.columns(['tenant_id', 'branch_id', 'product_id']).doUpdateSet({
              qty: sql`inventory_balances.qty + EXCLUDED.qty`,
              updated_at: sql`NOW()`
            })
          )
          .execute();
      });

      return reply.code(201).send({ success: true });
    }
  );

  const createAdjustmentBodySchema = z.object({
    branch_id: z.string().uuid(),
    reason: z.string().min(1).max(100),
    notes: z.string().optional(),
    items: z.array(z.object({
      product_id: z.string().uuid(),
      qty_change: z.coerce.number()
    })).min(1)
  });

  typedApp.post(
    '/inventory/adjustments',
    {
      preHandler: [app.requirePermissions(['inventory:adjust'])],
      schema: {
        tags: ['inventory'],
        security: [{ bearerAuth: [] }],
        body: createAdjustmentBodySchema
      }
    },
    async (request, reply) => {
      if (!request.auth) throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      
      const payload = createAdjustmentBodySchema.parse(request.body);
      await ensureBranchBelongsToTenant(request.auth.tenantId, payload.branch_id);
      ensureUserCanAccessBranch(request.auth, payload.branch_id);

      const adjustment = await app.db.transaction().execute(async (trx) => {
        const adj = await trx
          .insertInto('inventory_adjustments')
          .values({
            id: randomUUID(),
            tenant_id: request.auth!.tenantId,
            branch_id: payload.branch_id,
            reason: payload.reason,
            notes: payload.notes ?? null,
            status: 'COMPLETED',
            created_by_user_id: request.auth!.userId
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        for (const item of payload.items) {
          await trx
            .insertInto('inventory_adjustment_items')
            .values({
              id: randomUUID(),
              tenant_id: request.auth!.tenantId,
              branch_id: payload.branch_id,
              adjustment_id: adj.id,
              product_id: item.product_id,
              qty_change: item.qty_change.toString()
            })
            .execute();

          const operation = item.qty_change >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
          
          await trx
            .insertInto('inventory_transactions')
            .values({
              id: randomUUID(),
              tenant_id: request.auth!.tenantId,
              branch_id: payload.branch_id,
              product_id: item.product_id,
              operation: operation,
              reference_id: adj.id,
              qty_change: item.qty_change.toString(),
              notes: payload.reason,
              created_by_user_id: request.auth!.userId
            })
            .execute();

          await trx
            .insertInto('inventory_balances')
            .values({
              tenant_id: request.auth!.tenantId,
              branch_id: payload.branch_id,
              product_id: item.product_id,
              qty: item.qty_change.toString()
            })
            .onConflict((oc) =>
              oc.columns(['tenant_id', 'branch_id', 'product_id']).doUpdateSet({
                qty: sql`inventory_balances.qty + EXCLUDED.qty`,
                updated_at: sql`NOW()`
              })
            )
            .execute();
        }

        return adj;
      });

      return reply.code(201).send({ adjustment });
    }
  );
};

