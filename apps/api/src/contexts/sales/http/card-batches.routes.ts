import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';

/**
 * Cierre de lote de tarjeta.
 *
 * El comercio captura el total que imprimió su datáfono y el sistema responde al momento si
 * coincide con lo que registró, y en qué se diferencia. Sin esto, la discrepancia aparece
 * semanas después en la conciliación bancaria, cuando ya nadie recuerda el día.
 */

const reconcileSchema = z.object({
  branch_id: z.string().uuid(),
  terminal_id: z.string().uuid().optional(),
  acquirer: z.string().min(2).max(40),
  batch_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD'),
  declared_total_cents: z.number().int().nonnegative(),
  declared_count: z.number().int().nonnegative(),
  notes: z.string().max(300).optional()
});

export const cardBatchesRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  /** Lo que el sistema registró con tarjeta ese día, para comparar antes de cerrar. */
  typedApp.get(
    '/card-batches/preview',
    {
      preHandler: [app.requirePermissions(['cash:audit'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          branch_id: z.string().uuid(),
          batch_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
        })
      }
    },
    async (request) => {
      const { branch_id, batch_date } = request.query;

      const resumen = await request.executeAsTenant(async (trx) => {
        const filas = await trx
          .selectFrom('sale_payments as sp')
          .innerJoin('sales as s', 's.id', 'sp.sale_id')
          .select((eb) => [
            eb.fn.sum<number>('sp.amount_cents').as('total_cents'),
            eb.fn.count<number>('sp.id').as('count')
          ])
          .where('sp.tenant_id', '=', request.auth!.tenantId!)
          .where('sp.branch_id', '=', branch_id)
          .where('sp.kind', '=', 'CARD')
          .where('s.status', '=', 'COMPLETED')
          .where((eb) => eb.between('sp.created_at', new Date(`${batch_date}T00:00:00`), new Date(`${batch_date}T23:59:59.999`)))
          .executeTakeFirstOrThrow();

        const detalle = await trx
          .selectFrom('sale_payments as sp')
          .innerJoin('sales as s', 's.id', 'sp.sale_id')
          .select(['sp.reference', 'sp.amount_cents', 's.sale_number', 'sp.created_at'])
          .where('sp.tenant_id', '=', request.auth!.tenantId!)
          .where('sp.branch_id', '=', branch_id)
          .where('sp.kind', '=', 'CARD')
          .where('s.status', '=', 'COMPLETED')
          .where((eb) => eb.between('sp.created_at', new Date(`${batch_date}T00:00:00`), new Date(`${batch_date}T23:59:59.999`)))
          .orderBy('sp.created_at', 'asc')
          .execute();

        return { filas, detalle };
      });

      return {
        system_total_cents: Number(resumen.filas.total_cents ?? 0),
        system_count: Number(resumen.filas.count),
        transactions: resumen.detalle.map((fila) => ({
          approval_code: fila.reference,
          amount_cents: fila.amount_cents,
          sale_number: Number(fila.sale_number),
          at: fila.created_at.toISOString()
        }))
      };
    }
  );

  typedApp.post(
    '/card-batches',
    {
      preHandler: [app.requirePermissions(['cash:audit'])],
      schema: { tags: ['sales'], security: [{ bearerAuth: [] }], body: reconcileSchema }
    },
    async (request, reply) => {
      const body = reconcileSchema.parse(request.body);

      const resultado = await request.executeAsTenant(async (trx) => {
        const sistema = await trx
          .selectFrom('sale_payments as sp')
          .innerJoin('sales as s', 's.id', 'sp.sale_id')
          .select((eb) => [
            eb.fn.coalesce(eb.fn.sum<number>('sp.amount_cents'), eb.lit(0)).as('total_cents'),
            eb.fn.count<number>('sp.id').as('count')
          ])
          .where('sp.tenant_id', '=', request.auth!.tenantId!)
          .where('sp.branch_id', '=', body.branch_id)
          .where('sp.kind', '=', 'CARD')
          .where('s.status', '=', 'COMPLETED')
          .where((eb) =>
            eb.between(
              'sp.created_at',
              new Date(`${body.batch_date}T00:00:00`),
              new Date(`${body.batch_date}T23:59:59.999`)
            )
          )
          .executeTakeFirstOrThrow();

        const systemTotal = Number(sistema.total_cents);
        const systemCount = Number(sistema.count);
        const diff = body.declared_total_cents - systemTotal;

        const id = randomUUID();

        try {
          await trx
            .insertInto('card_batches')
            .values({
              id,
              tenant_id: request.auth!.tenantId!,
              branch_id: body.branch_id,
              terminal_id: body.terminal_id ?? null,
              acquirer: body.acquirer.toUpperCase(),
              batch_date: new Date(`${body.batch_date}T12:00:00`),
              declared_total_cents: body.declared_total_cents,
              declared_count: body.declared_count,
              system_total_cents: systemTotal,
              system_count: systemCount,
              diff_cents: diff,
              status: diff === 0 && body.declared_count === systemCount ? 'MATCHED' : 'MISMATCHED',
              reconciled_by_user_id: request.auth!.userId,
              notes: body.notes ?? null
            })
            .execute();
        } catch (error) {
          // El índice único impide conciliar dos veces el mismo cierre: dos conciliaciones
          // del mismo lote serían dos verdades sobre el mismo dinero.
          if (error instanceof Error && error.message.includes('uq_card_batches_day')) {
            throw new AppError(409, 'CARD_BATCH_ALREADY_RECONCILED', 'Ese lote ya fue conciliado');
          }
          throw error;
        }

        return {
          id,
          system_total_cents: systemTotal,
          system_count: systemCount,
          diff_cents: diff,
          status: diff === 0 && body.declared_count === systemCount ? 'MATCHED' : 'MISMATCHED'
        };
      });

      return reply.code(201).send(resultado);
    }
  );
};
