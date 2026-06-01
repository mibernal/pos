import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import {
  createInventoryTransactionBodySchema,
  consolidatedInventoryResponseSchema,
  createTransferBodySchema,
  shipTransferBodySchema,
  receiveTransferBodySchema,
  inventoryBalancesQuerySchema
} from '@pos-dian/shared';
import { ensureUserCanAccessBranch } from '../../../shared/infra/security/permissions.js';

export async function recordInventoryTransaction(
  trx: any, // Kysely Transaction type
  params: {
    tenantId: string;
    branchId: string;
    productId: string;
    variantId: string | null;
    operation: any; // InventoryOperation
    referenceId: string | null;
    qtyChange: number;
    inTransitChange?: number;
    reservedChange?: number;
    notes: string | null;
    userId: string;
  }): Promise<void> {
  const { tenantId, branchId, productId, variantId, operation, referenceId, qtyChange, inTransitChange = 0, reservedChange = 0, notes, userId } = params;

  let balanceQuery = trx
    .selectFrom('inventory_balances')
    .select(['on_hand_qty', 'in_transit_qty', 'reserved_qty'])
    .where('tenant_id', '=', tenantId)
    .where('branch_id', '=', branchId)
    .where('product_id', '=', productId)
    .forUpdate();

  if (variantId) {
    balanceQuery = balanceQuery.where('variant_id', '=', variantId);
  } else {
    balanceQuery = balanceQuery.where('variant_id', 'is', null);
  }

  const balance = await balanceQuery.executeTakeFirst();
  const currentQty = balance ? Number(balance.on_hand_qty) : 0;
  const newQty = currentQty + qtyChange;

  // Trigger INVENTORY_LOW_STOCK Alert if decreasing and crosses threshold
  if (qtyChange < 0) {
    const product = await trx
      .selectFrom('products')
      .select(['name', 'min_stock_alert_qty'])
      .where('id', '=', productId)
      .executeTakeFirst();

    if (product && product.min_stock_alert_qty !== null) {
      const threshold = product.min_stock_alert_qty;
      if (currentQty >= threshold && newQty < threshold) {
        // Crosses threshold downwards -> emit alert
        await trx
          .insertInto('tenant_alerts')
          .values({
            tenant_id: tenantId,
            branch_id: branchId,
            type: 'INVENTORY_LOW_STOCK',
            severity: 'WARNING',
            title: 'Stock Bajo Detectado',
            message: `El producto "${product.name}" ha caído por debajo del nivel mínimo (${threshold}). Cantidad actual: ${newQty}.`,
            metadata: JSON.stringify({ product_id: productId, variant_id: variantId, on_hand_qty: newQty, min_stock_alert_qty: threshold }),
            status: 'UNREAD'
          })
          .execute();
      }
    }
  }

  if (newQty < 0) {
    const tenant = await trx
      .selectFrom('tenants')
      .select(['allow_negative_stock'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    if (!tenant?.allow_negative_stock) {
      throw new AppError(400, 'INSUFFICIENT_STOCK', 'No hay stock suficiente y la sucursal no permite stock negativo');
    }
  }

  await trx
    .insertInto('inventory_balances')
    .values({
      tenant_id: tenantId,
      branch_id: branchId,
      product_id: productId,
      variant_id: variantId,
      on_hand_qty: qtyChange.toString(),
      in_transit_qty: inTransitChange.toString(),
      reserved_qty: reservedChange.toString()
    })
    .onConflict((oc: any) =>
      oc.constraint('uq_inv_balances_tenant_branch_prod_var').doUpdateSet({
        on_hand_qty: sql`inventory_balances.on_hand_qty + EXCLUDED.on_hand_qty`,
        in_transit_qty: sql`inventory_balances.in_transit_qty + EXCLUDED.in_transit_qty`,
        reserved_qty: sql`inventory_balances.reserved_qty + EXCLUDED.reserved_qty`,
        updated_at: sql`NOW()`
      })
    )
    .execute();

  if (qtyChange !== 0) {
    await trx
      .insertInto('inventory_transactions')
      .values({
        id: randomUUID(),
        tenant_id: tenantId,
        branch_id: branchId,
        product_id: productId,
        variant_id: variantId,
        operation,
        reference_id: referenceId,
        qty_change: qtyChange.toString(),
        balance_after: newQty.toString(),
        notes,
        created_by_user_id: userId
      })
      .execute();
  }
}

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
      preHandler: [app.requirePermissions(['inventory:view'])],
      schema: {
        tags: ['inventory'],
        security: [{ bearerAuth: [] }],
        querystring: inventoryBalancesQuerySchema
      }
    },
    async (request) => {
      const { branch_id, product_id, variant_id } = request.query as any;
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
          'b.variant_id',
          'b.on_hand_qty',
          'b.reserved_qty',
          'b.in_transit_qty',
          'b.updated_at',
          'p.name as product_name',
          'p.image_url'
        ])
        .where('b.tenant_id', '=', request.auth!.tenantId)
        .where('b.branch_id', '=', branch_id);

      if (product_id) {
        query = query.where('b.product_id', '=', product_id);
      }
      if (variant_id) {
        query = query.where('b.variant_id', '=', variant_id);
      }

      const rows = await query.orderBy('p.name', 'asc').execute();

      return rows.map((row) => ({
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        product_id: row.product_id,
        variant_id: row.variant_id ?? null,
        on_hand_qty: Number(row.on_hand_qty),
        reserved_qty: Number(row.reserved_qty),
        in_transit_qty: Number(row.in_transit_qty),
        updated_at: row.updated_at.toISOString(),
        product_name: row.product_name,
        image_url: row.image_url
      }));
    }
  );

  typedApp.get(
    '/inventory/consolidated',
    {
      preHandler: [app.requirePermissions(['inventory:view'])],
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
          'b.variant_id',
          'p.name as product_name',
          'p.category',
          'p.image_url',
          sql<number>`sum(b.on_hand_qty)`.as('total_on_hand_qty'),
          sql<number>`sum(b.reserved_qty)`.as('total_reserved_qty'),
          sql<number>`sum(b.in_transit_qty)`.as('total_in_transit_qty'),
          sql<{ branch_id: string; branch_name: string; on_hand_qty: number; reserved_qty: number; in_transit_qty: number }[]>`json_agg(json_build_object(
            'branch_id', br.id,
            'branch_name', br.name,
            'on_hand_qty', b.on_hand_qty,
            'reserved_qty', b.reserved_qty,
            'in_transit_qty', b.in_transit_qty
          ))`.as('branches_breakdown')
        ])
        .where('b.tenant_id', '=', request.auth!.tenantId)
        .groupBy(['b.product_id', 'b.variant_id', 'p.name', 'p.category', 'p.image_url'])
        .orderBy('p.name', 'asc')
        .execute();

      return rows.map((row) => ({
        product_id: row.product_id,
        variant_id: row.variant_id ?? null,
        product_name: row.product_name,
        category: row.category,
        image_url: row.image_url,
        total_on_hand_qty: Number(row.total_on_hand_qty),
        total_reserved_qty: Number(row.total_reserved_qty),
        total_in_transit_qty: Number(row.total_in_transit_qty),
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
        await recordInventoryTransaction(trx, {
          tenantId: request.auth!.tenantId,
          branchId: payload.branch_id,
          productId: payload.product_id,
          variantId: payload.variant_id ?? null,
          operation: payload.operation,
          referenceId: null,
          qtyChange: payload.qty_change,
          notes: payload.notes ?? null,
          userId: request.auth!.userId
        });
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
      variant_id: z.string().uuid().optional().nullable(),
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
              variant_id: item.variant_id ?? null,
              qty_change: item.qty_change.toString()
            })
            .execute();

          const operation = item.qty_change >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';

          await recordInventoryTransaction(trx, {
            tenantId: request.auth!.tenantId,
            branchId: payload.branch_id,
            productId: item.product_id,
            variantId: item.variant_id ?? null,
            operation,
            referenceId: adj.id,
            qtyChange: item.qty_change,
            notes: payload.reason,
            userId: request.auth!.userId
          });
        }

        return adj;
      });

      return reply.code(201).send({ adjustment });
    }
  );
  typedApp.post(
    '/inventory/transfers',
    {
      preHandler: [app.requirePermissions(['inventory:transfer'])],
      schema: {
        tags: ['inventory'],
        security: [{ bearerAuth: [] }],
        body: createTransferBodySchema
      }
    },
    async (request, reply) => {
      const payload = request.body;
      await ensureBranchBelongsToTenant(request.auth!.tenantId, payload.from_branch_id);
      ensureUserCanAccessBranch(request.auth, payload.from_branch_id);

      const transfer = await app.db.transaction().execute(async (trx) => {
        const trId = randomUUID();
        const tr = await trx
          .insertInto('inventory_transfers')
          .values({
            id: trId,
            tenant_id: request.auth!.tenantId,
            from_branch_id: payload.from_branch_id,
            to_branch_id: payload.to_branch_id,
            status: 'DRAFT',
            notes: payload.notes ?? null,
            created_by_user_id: request.auth!.userId
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        for (const item of payload.items) {
          await trx
            .insertInto('inventory_transfer_items')
            .values({
              id: randomUUID(),
              tenant_id: request.auth!.tenantId,
              transfer_id: tr.id,
              product_id: item.product_id,
              variant_id: item.variant_id ?? null,
              shipped_qty: item.qty.toString()
            })
            .execute();
        }
        return tr;
      });

      return reply.code(201).send({ transfer });
    }
  );

  typedApp.post(
    '/inventory/transfers/:id/ship',
    {
      preHandler: [app.requirePermissions(['inventory:transfer'])],
      schema: {
        tags: ['inventory'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: shipTransferBodySchema
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const payload = request.body;

      const transfer = await app.db.transaction().execute(async (trx) => {
        const tr = await trx
          .selectFrom('inventory_transfers')
          .selectAll()
          .where('id', '=', id)
          .where('tenant_id', '=', request.auth!.tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (!tr) throw new AppError(404, 'NOT_FOUND', 'Transferencia no encontrada');
        if (tr.status !== 'DRAFT') throw new AppError(400, 'INVALID_STATUS', 'La transferencia no está en DRAFT');

        ensureUserCanAccessBranch(request.auth, tr.from_branch_id);

        const items = await trx
          .selectFrom('inventory_transfer_items')
          .selectAll()
          .where('transfer_id', '=', tr.id)
          .execute();

        for (const item of items) {
          const qty = Number(item.shipped_qty);
          // 1. Reducir stock físico en from_branch
          await recordInventoryTransaction(trx, {
            tenantId: request.auth!.tenantId,
            branchId: tr.from_branch_id,
            productId: item.product_id,
            variantId: item.variant_id,
            operation: 'TRANSFER_OUT',
            referenceId: tr.id,
            qtyChange: -qty,
            notes: payload.notes ?? tr.notes,
            userId: request.auth!.userId
          });

          // 2. Aumentar stock en tránsito en to_branch
          await recordInventoryTransaction(trx, {
            tenantId: request.auth!.tenantId,
            branchId: tr.to_branch_id,
            productId: item.product_id,
            variantId: item.variant_id,
            operation: 'TRANSFER_IN', // No hacemos qtyChange, solo inTransitChange
            referenceId: tr.id,
            qtyChange: 0,
            inTransitChange: qty,
            notes: payload.notes ?? tr.notes,
            userId: request.auth!.userId
          });
        }

        const updated = await trx
          .updateTable('inventory_transfers')
          .set({
            status: 'IN_TRANSIT',
            shipped_at: new Date(),
            updated_at: new Date()
          })
          .where('id', '=', tr.id)
          .returningAll()
          .executeTakeFirstOrThrow();

        return updated;
      });

      return reply.code(200).send({ transfer });
    }
  );

  typedApp.post(
    '/inventory/transfers/:id/receive',
    {
      preHandler: [app.requirePermissions(['inventory:receive'])],
      schema: {
        tags: ['inventory'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: receiveTransferBodySchema
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const payload = request.body;

      const transfer = await app.db.transaction().execute(async (trx) => {
        const tr = await trx
          .selectFrom('inventory_transfers')
          .selectAll()
          .where('id', '=', id)
          .where('tenant_id', '=', request.auth!.tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (!tr) throw new AppError(404, 'NOT_FOUND', 'Transferencia no encontrada');
        if (tr.status !== 'IN_TRANSIT') throw new AppError(400, 'INVALID_STATUS', 'La transferencia no está en tránsito');

        ensureUserCanAccessBranch(request.auth, tr.to_branch_id);

        const items = await trx
          .selectFrom('inventory_transfer_items')
          .selectAll()
          .where('transfer_id', '=', tr.id)
          .execute();

        const receivedMap = new Map<string, number>(
          payload.items.map(i => [i.item_id, i.received_qty])
        );

        for (const item of items) {
          const shippedQty = Number(item.shipped_qty);
          const receivedQty = receivedMap.get(item.id) ?? shippedQty; // default a completo si no se especifica item parcial

          await trx
            .updateTable('inventory_transfer_items')
            .set({ received_qty: receivedQty.toString() })
            .where('id', '=', item.id)
            .execute();

          // Aumentar on_hand_qty y reducir in_transit_qty completo del original shipped_qty (la diferencia es pérdida/ajuste en tránsito)
          await recordInventoryTransaction(trx, {
            tenantId: request.auth!.tenantId,
            branchId: tr.to_branch_id,
            productId: item.product_id,
            variantId: item.variant_id,
            operation: 'TRANSFER_IN',
            referenceId: tr.id,
            qtyChange: receivedQty,
            inTransitChange: -shippedQty,
            notes: payload.notes ?? tr.notes,
            userId: request.auth!.userId
          });
        }

        const updated = await trx
          .updateTable('inventory_transfers')
          .set({
            status: 'RECEIVED',
            received_at: new Date(),
            updated_at: new Date()
          })
          .where('id', '=', tr.id)
          .returningAll()
          .executeTakeFirstOrThrow();

        return updated;
      });

      return reply.code(200).send({ transfer });
    }
  );

  typedApp.post(
    '/inventory/transfers/:id/reject',
    {
      preHandler: [app.requirePermissions(['inventory:receive'])], // Or transfer? Let's use receive since it's the receiving end
      schema: {
        tags: ['inventory'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: shipTransferBodySchema // Reuse ship schema for notes
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const payload = request.body;

      const transfer = await app.db.transaction().execute(async (trx) => {
        const tr = await trx
          .selectFrom('inventory_transfers')
          .selectAll()
          .where('id', '=', id)
          .where('tenant_id', '=', request.auth!.tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (!tr) throw new AppError(404, 'NOT_FOUND', 'Transferencia no encontrada');
        if (tr.status !== 'IN_TRANSIT') throw new AppError(400, 'INVALID_STATUS', 'La transferencia no está en tránsito');

        ensureUserCanAccessBranch(request.auth, tr.to_branch_id); // The receiving branch rejects it

        const items = await trx
          .selectFrom('inventory_transfer_items')
          .selectAll()
          .where('transfer_id', '=', tr.id)
          .execute();

        for (const item of items) {
          const shippedQty = Number(item.shipped_qty);

          await trx
            .updateTable('inventory_transfer_items')
            .set({ received_qty: '0' })
            .where('id', '=', item.id)
            .execute();

          // Aumentar on_hand_qty de la branch de origen y reducir in_transit_qty de la destino
          await recordInventoryTransaction(trx, {
            tenantId: request.auth!.tenantId,
            branchId: tr.to_branch_id,
            productId: item.product_id,
            variantId: item.variant_id,
            operation: 'TRANSFER_IN', // Solo inTransitChange
            referenceId: tr.id,
            qtyChange: 0,
            inTransitChange: -shippedQty,
            notes: payload.notes ?? 'Rechazo de transferencia',
            userId: request.auth!.userId
          });

          await recordInventoryTransaction(trx, {
            tenantId: request.auth!.tenantId,
            branchId: tr.from_branch_id,
            productId: item.product_id,
            variantId: item.variant_id,
            operation: 'TRANSFER_IN',
            referenceId: tr.id,
            qtyChange: shippedQty,
            notes: payload.notes ?? 'Rechazo de transferencia',
            userId: request.auth!.userId
          });
        }

        const updated = await trx
          .updateTable('inventory_transfers')
          .set({
            status: 'REJECTED',
            updated_at: new Date()
          })
          .where('id', '=', tr.id)
          .returningAll()
          .executeTakeFirstOrThrow();

        return updated;
      });

      return reply.code(200).send({ transfer });
    }
  );
};

