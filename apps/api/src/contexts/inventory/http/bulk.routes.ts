import { z } from 'zod';
import { sql } from 'kysely';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { branchHeaderSchema } from '../services/products/schemas.js';
import { ensureUserCanAccessBranch } from '../../../shared/infra/security/permissions.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';
import { randomUUID } from 'node:crypto';
import { normalizeBranchHeader } from '../services/products/scope.js';

const bulkImportItemSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  category: z.string().min(1),
  tax_category: z.enum(['IVA_19', 'IVA_5', 'IVA_0', 'EXEMPT', 'EXCLUDED', 'INC_8']),
  barcode: z.string().nullable().optional(),
  price_cents: z.number().int().min(0),
  active: z.boolean().default(true),
  stock_to_add: z.number().int().default(0)
});

const bulkImportRequestSchema = z.object({
  items: z.array(bulkImportItemSchema).max(500, 'Máximo 500 items por carga')
});

export const bulkRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/bulk-import',
    {
      preHandler: [app.requirePermissions(['products:manage', 'inventory:adjust'])],
      schema: {
        tags: ['inventory-bulk'],
        security: [{ bearerAuth: [] }],
        headers: branchHeaderSchema,
        body: bulkImportRequestSchema
      }
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const headers = branchHeaderSchema.parse(request.headers);
      const branchIdFromHeader = normalizeBranchHeader(headers['x-branch-id']);
      if (!branchIdFromHeader) {
        throw new AppError(400, 'BRANCH_REQUIRED', 'Se requiere seleccionar una sucursal para la carga masiva');
      }
      ensureUserCanAccessBranch(request.auth, branchIdFromHeader);

      const payload = bulkImportRequestSchema.parse(request.body);

      if (payload.items.length === 0) {
        return reply.code(200).send({ success: true, imported: 0 });
      }

      const tenantId = request.auth!.tenantId!;

      await app.db.transaction().execute(async (trx) => {
        for (const item of payload.items) {
          let productId = item.id;
          let isNew = false;

          if (productId) {
            // Verify if product exists
            const existing = await trx
              .selectFrom('products')
              .select(['id', 'branch_id'])
              .where('tenant_id', '=', tenantId)
              .where('id', '=', productId)
              .executeTakeFirst();
              
            if (!existing) {
              productId = undefined; // Force creation if ID not found
            }
          }

          if (!productId) {
            productId = randomUUID();
            isNew = true;
            await trx
              .insertInto('products')
              .values({
                id: productId,
                tenant_id: tenantId!,
                branch_id: branchIdFromHeader,
                name: item.name,
                category: item.category,
                tax_category: item.tax_category,
                barcode: item.barcode ?? null,
                price_cents: item.price_cents,
                cost_cents: 0,
                active: item.active
              })
              .execute();
          } else {
            await trx
              .updateTable('products')
              .set({
                name: item.name,
                category: item.category,
                tax_category: item.tax_category,
                barcode: item.barcode ?? null,
                price_cents: item.price_cents,
                active: item.active
              })
              .where('tenant_id', '=', tenantId)
              .where('id', '=', productId)
              .execute();
          }

          if (item.stock_to_add && item.stock_to_add !== 0) {
            // Add stock transaction
            const txId = randomUUID();
            await trx
              .insertInto('inventory_transactions')
              .values({
                id: txId,
                tenant_id: tenantId!,
                branch_id: branchIdFromHeader,
                product_id: productId,
                variant_id: null,
                operation: item.stock_to_add > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
                reference_id: null,
                qty_change: item.stock_to_add.toString(),
                balance_after: null,
                notes: 'Carga masiva (CSV)',
                created_by_user_id: request.auth!.userId
              })
              .execute();

            const existingBalance = await trx
              .selectFrom('inventory_balances')
              .select('id')
              .where('tenant_id', '=', tenantId)
              .where('branch_id', '=', branchIdFromHeader)
              .where('product_id', '=', productId)
              .where('variant_id', 'is', null)
              .executeTakeFirst();

            if (existingBalance) {
               await trx.updateTable('inventory_balances')
                  .set({
                     on_hand_qty: sql`inventory_balances.on_hand_qty + ${item.stock_to_add}`
                  })
                  .where('id', '=', existingBalance.id)
                  .execute();
            } else {
               await trx.insertInto('inventory_balances')
                  .values({
                     tenant_id: tenantId!,
                     branch_id: branchIdFromHeader,
                     product_id: productId,
                     variant_id: null,
                     on_hand_qty: item.stock_to_add.toString()
                  })
                  .execute();
            }
          }
          
          await writeAuditLog(trx, {
             tenantId: tenantId,
             branchId: branchIdFromHeader,
             userId: request.auth!.userId,
             entityType: 'PRODUCT',
             entityId: productId,
             action: isNew ? 'PRODUCT_CREATED' : 'PRODUCT_UPDATED',
             payloadJson: { source: 'BULK_IMPORT', ...item }
          });
        }
      });

      return reply.code(200).send({
        success: true,
        imported: payload.items.length
      });
    }
  );
};
