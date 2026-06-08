import { sql } from 'kysely';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import {
  scanBatchBodySchema,
  commitReceiptBodySchema,
  createCountBodySchema,
  commitCountBodySchema
} from '@pos-dian/shared';
import { ensureUserCanAccessBranch } from '../../../shared/infra/security/permissions.js';
import { recordInventoryTransaction } from './inventory.routes.js'; // I'll export this from inventory.routes.ts

export const scannerRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // --- RECEIPT SCANNER ---

  typedApp.post(
    '/inventory/receipts/:id/scan-batch',
    {
      preHandler: [app.requirePermissions(['inventory:receive'])],
      schema: {
        tags: ['inventory-scanner'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: scanBatchBodySchema
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const { items } = request.body;

      await app.db.transaction().execute(async (trx) => {
        const receipt = await trx
          .selectFrom('inventory_receipts')
          .selectAll()
          .where('id', '=', id)
          .where('tenant_id', '=', request.auth!.tenantId!)
          .executeTakeFirst();

        if (!receipt) throw new AppError(404, 'NOT_FOUND', 'Recepción no encontrada');
        if (receipt.status !== 'DRAFT') throw new AppError(400, 'INVALID_STATUS', 'La recepción no está en DRAFT');

        if (receipt.branch_id) {
          ensureUserCanAccessBranch(request.auth, receipt.branch_id);
        }

        for (const item of items) {
          // Check if item exists in receipt
          const existing = await trx
            .selectFrom('inventory_receipt_items')
            .selectAll()
            .where('receipt_id', '=', receipt.id)
            .where('product_id', '=', item.product_id)
            // handle nullable variant_id
            .where((eb) => 
               item.variant_id 
                 ? eb('variant_id', '=', item.variant_id) 
                 : eb('variant_id', 'is', null)
            )
            .executeTakeFirst();

          if (existing) {
            await trx
              .updateTable('inventory_receipt_items')
              .set((eb) => ({
                received_qty: sql`${eb.ref('received_qty')} + ${item.scanned_qty_delta}`
              }))
              .where('id', '=', existing.id)
              .execute();
          } else {
            await trx
              .insertInto('inventory_receipt_items')
              .values({
                id: randomUUID(),
                tenant_id: request.auth!.tenantId!,
                branch_id: receipt.branch_id,
                receipt_id: receipt.id,
                product_id: item.product_id,
                variant_id: item.variant_id ?? null,
                received_qty: item.scanned_qty_delta.toString(),
                cost_cents: 0 // Will need to be defined later or via PO
              })
              .execute();
          }
        }
      });

      return reply.code(200).send({ success: true });
    }
  );

  typedApp.post(
    '/inventory/receipts/:id/commit',
    {
      preHandler: [app.requirePermissions(['inventory:receive'])],
      schema: {
        tags: ['inventory-scanner'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: commitReceiptBodySchema
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const { discrepancy_approved_by_pin, notes } = request.body; // eslint-disable-line @typescript-eslint/no-unused-vars

      const receipt = await app.db.transaction().execute(async (trx) => {
        const rcpt = await trx
          .selectFrom('inventory_receipts')
          .selectAll()
          .where('id', '=', id)
          .where('tenant_id', '=', request.auth!.tenantId!)
          .forUpdate()
          .executeTakeFirst();

        if (!rcpt) throw new AppError(404, 'NOT_FOUND', 'Recepción no encontrada');
        if (rcpt.status !== 'DRAFT') throw new AppError(400, 'INVALID_STATUS', 'La recepción no está en DRAFT');
        
        if (!rcpt.branch_id) throw new AppError(400, 'NO_BRANCH', 'Recepción no tiene sucursal asignada');
        ensureUserCanAccessBranch(request.auth, rcpt.branch_id);

        // TODO: Validate differences against PO if PO_LINKED, require PIN if differences

        const items = await trx
          .selectFrom('inventory_receipt_items')
          .selectAll()
          .where('receipt_id', '=', rcpt.id)
          .execute();

        for (const item of items) {
          const qty = Number(item.received_qty);
          if (qty > 0) {
            await recordInventoryTransaction(trx, {
              tenantId: request.auth!.tenantId!,
              branchId: rcpt.branch_id!,
              productId: item.product_id,
              variantId: item.variant_id,
              operation: 'PO_RECEIPT',
              referenceId: rcpt.id,
              qtyChange: qty,
              notes: notes ?? rcpt.notes,
              userId: request.auth!.userId
            });
          }
        }

        const updated = await trx
          .updateTable('inventory_receipts')
          .set({
            status: 'COMPLETED',
            notes: notes ?? rcpt.notes,
            updated_at: new Date()
          })
          .where('id', '=', rcpt.id)
          .returningAll()
          .executeTakeFirstOrThrow();
          
        return updated;
      });

      return reply.code(200).send({ receipt });
    }
  );

  // --- COUNTS SCANNER ---

  typedApp.post(
    '/inventory/counts',
    {
      preHandler: [app.requirePermissions(['inventory:adjust'])], // Audits usually require adjust permissions
      schema: {
        tags: ['inventory-scanner'],
        security: [{ bearerAuth: [] }],
        body: createCountBodySchema
      }
    },
    async (request, reply) => {
      const payload = request.body;
      ensureUserCanAccessBranch(request.auth, payload.branch_id);

      const count = await app.db.transaction().execute(async (trx) => {
        return await trx
          .insertInto('inventory_counts')
          .values({
            id: randomUUID(),
            tenant_id: request.auth!.tenantId!,
            branch_id: payload.branch_id,
            name: payload.name,
            status: 'DRAFT',
            started_by_user_id: request.auth!.userId,
            created_at: new Date()
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      });

      return reply.code(201).send({ count });
    }
  );

  typedApp.post(
    '/inventory/counts/:id/scan-batch',
    {
      preHandler: [app.requirePermissions(['inventory:adjust'])],
      schema: {
        tags: ['inventory-scanner'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: scanBatchBodySchema
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const { items } = request.body;

      await app.db.transaction().execute(async (trx) => {
        const count = await trx
          .selectFrom('inventory_counts')
          .selectAll()
          .where('id', '=', id)
          .where('tenant_id', '=', request.auth!.tenantId!)
          .executeTakeFirst();

        if (!count) throw new AppError(404, 'NOT_FOUND', 'Conteo no encontrado');
        if (count.status === 'COMPLETED' || count.status === 'CANCELED') throw new AppError(400, 'INVALID_STATUS', 'El conteo ya finalizó');

        ensureUserCanAccessBranch(request.auth, count.branch_id);

        for (const item of items) {
          const existing = await trx
            .selectFrom('inventory_count_items')
            .selectAll()
            .where('count_id', '=', count.id)
            .where('product_id', '=', item.product_id)
            .where((eb) => 
               item.variant_id 
                 ? eb('variant_id', '=', item.variant_id) 
                 : eb('variant_id', 'is', null)
            )
            .executeTakeFirst();

          if (existing) {
            const newCounted = Number(existing.counted_qty) + item.scanned_qty_delta;
            const systemQty = Number(existing.system_qty);
            const diff = newCounted - systemQty;

            await trx
              .updateTable('inventory_count_items')
              .set({
                counted_qty: newCounted,
                diff_qty: diff
              })
              .where('id', '=', existing.id)
              .execute();
          } else {
            // Get system qty to compute diff
            const bal = await trx
              .selectFrom('inventory_balances')
              .select(['on_hand_qty'])
              .where('tenant_id', '=', request.auth!.tenantId!)
              .where('branch_id', '=', count.branch_id)
              .where('product_id', '=', item.product_id)
              .where((eb) => 
                 item.variant_id 
                   ? eb('variant_id', '=', item.variant_id) 
                   : eb('variant_id', 'is', null)
              )
              .executeTakeFirst();
              
            const systemQty = bal ? Number(bal.on_hand_qty) : 0;
            const newCounted = item.scanned_qty_delta;
            const diff = newCounted - systemQty;

            await trx
              .insertInto('inventory_count_items')
              .values({
                id: randomUUID(),
                tenant_id: request.auth!.tenantId!,
                count_id: count.id,
                product_id: item.product_id,
                variant_id: item.variant_id ?? null,
                system_qty: systemQty,
                counted_qty: newCounted,
                diff_qty: diff
              })
              .execute();
          }
        }
        
        if (count.status === 'DRAFT') {
            await trx.updateTable('inventory_counts')
                .set({status: 'COUNTING'})
                .where('id', '=', count.id)
                .execute();
        }
      });

      return reply.code(200).send({ success: true });
    }
  );

  typedApp.post(
    '/inventory/counts/:id/commit',
    {
      preHandler: [app.requirePermissions(['inventory:adjust'])],
      schema: {
        tags: ['inventory-scanner'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: commitCountBodySchema
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const { discrepancy_approved_by_pin, notes } = request.body; // eslint-disable-line @typescript-eslint/no-unused-vars

      const count = await app.db.transaction().execute(async (trx) => {
        const cnt = await trx
          .selectFrom('inventory_counts')
          .selectAll()
          .where('id', '=', id)
          .where('tenant_id', '=', request.auth!.tenantId!)
          .forUpdate()
          .executeTakeFirst();

        if (!cnt) throw new AppError(404, 'NOT_FOUND', 'Conteo no encontrado');
        if (cnt.status === 'COMPLETED' || cnt.status === 'CANCELED') throw new AppError(400, 'INVALID_STATUS', 'El conteo ya finalizó');

        ensureUserCanAccessBranch(request.auth, cnt.branch_id);

        const items = await trx
          .selectFrom('inventory_count_items')
          .selectAll()
          .where('count_id', '=', cnt.id)
          .where('diff_qty', '!=', 0)
          .execute();

        // TODO: Require PIN verification for discrepancy_approved_by_pin if items.length > 0

        for (const item of items) {
          const diff = Number(item.diff_qty);
          if (diff !== 0) {
            await recordInventoryTransaction(trx, {
              tenantId: request.auth!.tenantId!,
              branchId: cnt.branch_id,
              productId: item.product_id,
              variantId: item.variant_id,
              operation: 'CYCLE_COUNT',
              referenceId: cnt.id,
              qtyChange: diff,
              notes: notes ?? cnt.name,
              userId: request.auth!.userId
            });
          }
        }

        const updated = await trx
          .updateTable('inventory_counts')
          .set({
            status: 'COMPLETED',
            completed_at: new Date(),
            approved_by_user_id: request.auth!.userId // Or the PIN owner
          })
          .where('id', '=', cnt.id)
          .returningAll()
          .executeTakeFirstOrThrow();
          
        return updated;
      });

      return reply.code(200).send({ count });
    }
  );
};
