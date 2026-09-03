import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { registerReceivablePaymentSchema, upsertCreditAccountSchema, PAYMENT_KIND_BEHAVIOR } from '@pos-dian/shared';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { ReceivablesService } from '../application/receivables.service.js';

/**
 * Cuentas por cobrar: cupo, estado de cuenta y abonos.
 */
export const receivablesRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  /** Cartera: quién debe y cuánto, con lo vencido primero. */
  typedApp.get(
    '/receivables',
    {
      preHandler: [app.requirePermissions(['reports:view'])],
      schema: { tags: ['sales'], security: [{ bearerAuth: [] }] }
    },
    async (request) => {
      const now = new Date();

      const filas = await request.executeAsTenant(async (trx) =>
        trx
          .selectFrom('customer_receivables as r')
          .innerJoin('customers as c', 'c.id', 'r.customer_id')
          .select((eb) => [
            'r.customer_id',
            'c.name as customer_name',
            eb.fn.sum<number>('r.balance_cents').as('balance_cents'),
            eb.fn.count<number>('r.id').as('documents'),
            eb.fn.min('r.due_at').as('oldest_due_at')
          ])
          .where('r.tenant_id', '=', request.auth!.tenantId!)
          .where('r.status', '=', 'OPEN')
          .groupBy(['r.customer_id', 'c.name'])
          .orderBy('balance_cents', 'desc')
          .execute()
      );

      return {
        customers: filas.map((fila) => ({
          customer_id: fila.customer_id,
          customer_name: fila.customer_name,
          balance_cents: Number(fila.balance_cents),
          documents: Number(fila.documents),
          oldest_due_at: fila.oldest_due_at ? new Date(fila.oldest_due_at).toISOString() : null,
          overdue: Boolean(fila.oldest_due_at && new Date(fila.oldest_due_at) < now)
        })),
        total_cents: filas.reduce((suma, fila) => suma + Number(fila.balance_cents), 0)
      };
    }
  );

  typedApp.get(
    '/customers/:id/statement',
    {
      preHandler: [app.requirePermissions(['reports:view'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() })
      }
    },
    async (request) =>
      request.executeAsTenant(async (trx) =>
        ReceivablesService.statement(trx, request.auth!.tenantId!, request.params.id)
      )
  );

  typedApp.put(
    '/customers/:id/credit',
    {
      preHandler: [app.requirePermissions(['settings:manage'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: upsertCreditAccountSchema
      }
    },
    async (request, reply) => {
      const body = upsertCreditAccountSchema.parse(request.body);

      await request.executeAsTenant(async (trx) =>
        ReceivablesService.upsertAccount(trx, request.auth!.tenantId!, request.params.id, body)
      );

      const statement = await request.executeAsTenant(async (trx) =>
        ReceivablesService.statement(trx, request.auth!.tenantId!, request.params.id)
      );

      return reply.send({ account: statement.account });
    }
  );

  /**
   * Registrar un abono.
   *
   * Lo puede hacer quien cobra, no solo quien administra: el cliente que viene a pagar su
   * fiado llega al mostrador, y obligar a llamar al dueño para recibirle cincuenta mil es
   * exactamente el tipo de fricción por la que un comercio vuelve al cuaderno.
   */
  typedApp.post(
    '/customers/:id/payments',
    {
      preHandler: [app.requirePermissions(['sales:create'])],
      schema: {
        tags: ['sales'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: registerReceivablePaymentSchema
      }
    },
    async (request, reply) => {
      const body = registerReceivablePaymentSchema.parse(request.body);

      if (PAYMENT_KIND_BEHAVIOR[body.method].affectsCashDrawer && !body.cash_session_id) {
        throw new AppError(
          400,
          'CASH_SESSION_REQUIRED',
          'Un abono en efectivo tiene que registrarse dentro de un turno de caja abierto'
        );
      }

      const resultado = await request.executeAsTenant(async (trx) => {
        if (body.cash_session_id) {
          // El turno tiene que estar abierto: un abono contra un turno cerrado cambiaría un
          // arqueo que ya se firmó.
          const turno = await trx
            .selectFrom('cash_sessions')
            .select(['id', 'closed_at'])
            .where('tenant_id', '=', request.auth!.tenantId!)
            .where('id', '=', body.cash_session_id)
            .executeTakeFirst();

          if (!turno) throw new AppError(404, 'CASH_SESSION_NOT_FOUND', 'El turno de caja no existe');
          if (turno.closed_at) {
            throw new AppError(409, 'CASH_SESSION_ALREADY_CLOSED', 'El turno de caja ya está cerrado');
          }
        }

        return ReceivablesService.registerPayment(trx, {
          tenantId: request.auth!.tenantId!,
          customerId: request.params.id,
          branchId: body.branch_id,
          cashSessionId: body.cash_session_id ?? null,
          methodCode: body.method_code.toUpperCase(),
          kind: body.method,
          amountCents: body.amount_cents,
          reference: body.reference,
          notes: body.notes,
          userId: request.auth!.userId,
          receivableId: body.receivable_id
        });
      });

      const statement = await request.executeAsTenant(async (trx) =>
        ReceivablesService.statement(trx, request.auth!.tenantId!, request.params.id)
      );

      return reply.code(201).send({
        payment_id: resultado.paymentId,
        allocations: resultado.allocated,
        account: statement.account
      });
    }
  );
};
