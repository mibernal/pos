import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { deviationPercent, upsertRecipeSchema } from '@pos-dian/shared';
import { RecipesService } from '../application/recipes.service.js';

/**
 * Recetas y escandallo.
 *
 * Configurar la receta de un plato es configurar un producto, por eso escribir pide
 * `products:manage`; leerla es leer inventario. El informe de desviación es la razón de ser
 * de todo esto: sin él la receta solo sirve para descontar, con él sirve para encontrar la
 * fuga.
 */
export const recipesRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/recipes',
    {
      preHandler: [app.requirePermissions(['inventory:view'])],
      schema: { tags: ['inventory'], security: [{ bearerAuth: [] }] }
    },
    async (request) =>
      request.executeAsTenant((trx) => RecipesService.list(trx, request.auth!.tenantId!))
  );

  typedApp.get(
    '/recipes/:productId',
    {
      preHandler: [app.requirePermissions(['inventory:view'])],
      schema: {
        tags: ['inventory'],
        security: [{ bearerAuth: [] }],
        params: z.object({ productId: z.string().uuid() }),
        querystring: z.object({ variant_id: z.string().uuid().optional() })
      }
    },
    async (request, reply) => {
      const receta = await request.executeAsTenant((trx) =>
        RecipesService.get(trx, request.auth!.tenantId!, request.params.productId, request.query.variant_id ?? null)
      );

      /**
       * Un producto sin receta no es un error: la inmensa mayoría de los productos de un
       * comercio no la tienen. Se responde `null` para que la pantalla distinga «este plato
       * todavía no tiene escandallo» de «algo falló».
       */
      return reply.send(receta);
    }
  );

  typedApp.put(
    '/recipes/:productId',
    {
      preHandler: [app.requirePermissions(['products:manage'])],
      schema: {
        tags: ['inventory'],
        security: [{ bearerAuth: [] }],
        params: z.object({ productId: z.string().uuid() }),
        body: upsertRecipeSchema
      }
    },
    async (request) =>
      request.executeAsTenant((trx) =>
        RecipesService.upsert(trx, request.auth!.tenantId!, request.params.productId, request.body)
      )
  );

  typedApp.delete(
    '/recipes/:recipeId',
    {
      preHandler: [app.requirePermissions(['products:manage'])],
      schema: {
        tags: ['inventory'],
        security: [{ bearerAuth: [] }],
        params: z.object({ recipeId: z.string().uuid() })
      }
    },
    async (request, reply) => {
      await request.executeAsTenant((trx) =>
        RecipesService.remove(trx, request.auth!.tenantId!, request.params.recipeId)
      );
      return reply.code(204).send();
    }
  );

  /**
   * Desviación: lo que las recetas dicen que se consumió contra lo que el conteo encontró.
   *
   * El consumo teórico son los movimientos `RECIPE` del periodo —lo que la receta explica— y
   * el ajuste es lo que hubo que corregir tras contar. Un ajuste negativo del ocho por ciento
   * en el aceite significa que se está yendo un ocho por ciento más de lo que las recetas
   * explican: por porciones generosas, por derrame o porque alguien se lo lleva. El informe
   * no dice cuál de las tres, pero dice dónde mirar, que es lo que hoy no existe.
   */
  typedApp.get(
    '/recipes/reports/consumption-deviation',
    {
      preHandler: [app.requirePermissions(['inventory:view'])],
      schema: {
        tags: ['inventory'],
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          branch_id: z.string().uuid().optional(),
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
        })
      }
    },
    async (request) => {
      const { branch_id, from, to } = request.query;
      const tenantId = request.auth!.tenantId!;

      const filas = await request.executeAsTenant(async (trx) => {
        const resultado = await sql<{
          product_id: string;
          product_name: string;
          theoretical_qty: string;
          adjusted_qty: string;
          cost_cents: number;
        }>`
          SELECT p.id AS product_id,
                 p.name AS product_name,
                 COALESCE(SUM(CASE WHEN t.operation = 'RECIPE' THEN -t.qty_change ELSE 0 END), 0) AS theoretical_qty,
                 COALESCE(SUM(CASE WHEN t.operation IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'CYCLE_COUNT')
                                   THEN t.qty_change ELSE 0 END), 0) AS adjusted_qty,
                 p.cost_cents
            FROM inventory_transactions t
            JOIN products p ON p.id = t.product_id AND p.tenant_id = t.tenant_id
           WHERE t.tenant_id = ${tenantId}::uuid
             AND t.created_at >= ${`${from}T00:00:00`}::timestamptz
             AND t.created_at < (${`${to}T00:00:00`}::timestamptz + INTERVAL '1 day')
             AND (${branch_id ?? null}::uuid IS NULL OR t.branch_id = ${branch_id ?? null}::uuid)
             AND t.operation IN ('RECIPE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'CYCLE_COUNT')
           GROUP BY p.id, p.name, p.cost_cents
          HAVING COALESCE(SUM(CASE WHEN t.operation = 'RECIPE' THEN -t.qty_change ELSE 0 END), 0) > 0
           ORDER BY p.name
        `.execute(trx);

        return resultado.rows;
      });

      return filas.map((fila) => {
        const teorico = Number(fila.theoretical_qty);
        const ajustado = Number(fila.adjusted_qty);
        const costoUnitario = Number(fila.cost_cents);

        return {
          product_id: fila.product_id,
          product_name: fila.product_name,
          theoretical_qty: Number(teorico.toFixed(3)),
          adjusted_qty: Number(ajustado.toFixed(3)),
          deviation_percent: deviationPercent(teorico, ajustado),
          unit_cost_cents: costoUnitario,
          deviation_cost_cents: Math.round(ajustado * costoUnitario)
        };
      });
    }
  );
};
