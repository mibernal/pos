import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LedgerService } from '../../../shared/infra/db/ledger-service.js';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import {
  calculateDiffCents,
  calculateExpectedCashCents
} from '../domain/cash-sessions-service.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';
import { buildRequestLogContext } from '../../../shared/infra/logging/request-log-context.js';
import { ensureUserCanAccessBranch } from '../../../shared/infra/security/permissions.js';

const openCashSessionBodySchema = z.object({
  branch_id: z.string().uuid(),
  terminal_id: z.string().uuid(),
  opening_amount_cents: z.coerce.number().int().nonnegative()
});

const closeCashSessionParamsSchema = z.object({
  id: z.string().uuid()
});

const closeCashSessionBodySchema = z.object({
  closing_cash_real_cents: z.coerce.number().int().nonnegative()
});

const auditCashSessionBodySchema = z.object({
  observed_cash_cents: z.coerce.number().int().nonnegative(),
  notes: z.string().optional()
});

const currentCashSessionQuerySchema = z.object({
  terminal_id: z.string().uuid()
});

const cashMovementBodySchema = z.object({
  type: z.enum(['IN', 'OUT']),
  amount_cents: z.coerce.number().int().positive(),
  reason: z.string().min(3).max(255)
});

function mapCashSession(
  session: {
    id: string;
    tenant_id: string;
    branch_id: string;
    terminal_id: string;
    opened_by_user_id: string;
    opened_at: Date;
    opening_amount_cents: number;
    closed_at: Date | null;
    closing_cash_real_cents: number | null;
    expected_cash_cents: number | null;
    diff_cents: number | null;
    status: 'OPEN' | 'CLOSED' | 'RECONCILED';
  }
) {
  return {
    id: session.id,
    tenant_id: session.tenant_id,
    branch_id: session.branch_id,
    terminal_id: session.terminal_id,
    opened_by_user_id: session.opened_by_user_id,
    opened_at: session.opened_at.toISOString(),
    opening_amount_cents: session.opening_amount_cents,
    closed_at: session.closed_at ? session.closed_at.toISOString() : null,
    closing_cash_real_cents: session.closing_cash_real_cents,
    expected_cash_cents: session.expected_cash_cents,
    diff_cents: session.diff_cents,
    status: session.status
  };
}

async function assertTerminalBelongsToTenant(
  app: Parameters<FastifyPluginAsync>[0],
  tenantId: string,
  terminalId: string
): Promise<void> {
  const terminal = await app.db
    .selectFrom('terminals')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('id', '=', terminalId)
    .where('is_active', '=', true)
    .executeTakeFirst();

  if (!terminal) {
    throw new AppError(400, 'TERMINAL_NOT_FOUND', 'La terminal no existe o está inactiva');
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

export const cashSessionsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/cash-sessions/open',
    {
      preHandler: [app.requirePermissions(['cash:open'])],
      schema: {
        tags: ['cash-sessions'],
        security: [{ bearerAuth: [] }],
        body: openCashSessionBodySchema
      }
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const payload = openCashSessionBodySchema.parse(request.body);

      ensureUserCanAccessBranch(request.auth, payload.branch_id);
      await assertTerminalBelongsToTenant(app, request.auth.tenantId, payload.terminal_id);

      const existingOpenSession = await app.db
        .selectFrom('cash_sessions')
        .select('id')
        .where('tenant_id', '=', request.auth.tenantId)
        .where('terminal_id', '=', payload.terminal_id)
        .where('closed_at', 'is', null)
        .executeTakeFirst();

      if (existingOpenSession) {
        throw new AppError(
          409,
          'CASH_SESSION_ALREADY_OPEN',
          'Ya existe una caja abierta para esta terminal'
        );
      }

      let createdSession;
      try {
        createdSession = await app.db.transaction().execute(async (trx) => {
          const insertedSession = await trx
            .insertInto('cash_sessions')
            .values({
              id: randomUUID(),
              tenant_id: request.auth!.tenantId,
              branch_id: payload.branch_id,
              terminal_id: payload.terminal_id,
              opened_by_user_id: request.auth!.userId,
              opening_amount_cents: payload.opening_amount_cents,
              status: 'OPEN'
            })
            .returning([
              'id',
              'tenant_id',
              'branch_id',
              'terminal_id',
              'opened_by_user_id',
              'opened_at',
              'opening_amount_cents',
              'closed_at',
              'closing_cash_real_cents',
              'expected_cash_cents',
              'diff_cents',
              'status'
            ])
            .executeTakeFirstOrThrow();

          await LedgerService.appendCashLedger(trx, {
            tenantId: request.auth!.tenantId,
            cashSessionId: insertedSession.id,
            terminalId: insertedSession.terminal_id,
            type: 'OPENING',
            amountCents: insertedSession.opening_amount_cents,
            balanceAfterCents: insertedSession.opening_amount_cents
          });

          await writeAuditLog(trx, {
            tenantId: request.auth!.tenantId,
            branchId: insertedSession.branch_id,
            userId: request.auth!.userId,
            entityType: 'CASH_SESSION',
            entityId: insertedSession.id,
            action: 'CASH_SESSION_OPENED',
            payloadJson: {
              opening_amount_cents: insertedSession.opening_amount_cents,
              opened_by_user_id: insertedSession.opened_by_user_id,
              opened_at: insertedSession.opened_at.toISOString()
            }
          });

          return insertedSession;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError(
            409,
            'CASH_SESSION_ALREADY_OPEN',
            'Ya existe una caja abierta para esta terminal'
          );
        }
        throw error;
      }

      request.log.info(
        {
          ...buildRequestLogContext(request, {
            branchId: payload.branch_id
          }),
          terminal_id: payload.terminal_id,
          event: 'cash_session_opened',
          cash_session_id: createdSession.id,
          opening_amount_cents: createdSession.opening_amount_cents
        },
        'Cash session opened'
      );

      return reply.code(201).send({
        cash_session: mapCashSession(createdSession)
      });
    }
  );

  typedApp.post(
    '/cash-sessions/:id/audit',
    {
      preHandler: [app.requirePermissions(['cash:audit'])],
      schema: {
        tags: ['cash-sessions'],
        security: [{ bearerAuth: [] }],
        params: closeCashSessionParamsSchema,
        body: auditCashSessionBodySchema
      }
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const params = closeCashSessionParamsSchema.parse(request.params);
      const payload = auditCashSessionBodySchema.parse(request.body);

      const result = await app.db.transaction().execute(async (trx) => {
        const currentSession = await trx
          .selectFrom('cash_sessions')
          .select([
            'id',
            'tenant_id',
            'branch_id',
            'terminal_id',
            'opened_by_user_id',
            'opened_at',
            'opening_amount_cents',
            'closed_at'
          ])
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('id', '=', params.id)
          .executeTakeFirst();

        if (!currentSession) {
          throw new AppError(404, 'CASH_SESSION_NOT_FOUND', 'Sesión de caja no encontrada');
        }

        ensureUserCanAccessBranch(request.auth, currentSession.branch_id);

        if (currentSession.closed_at) {
          throw new AppError(409, 'CASH_SESSION_ALREADY_CLOSED', 'La sesión de caja ya está cerrada');
        }

        const salePayments = await trx
          .selectFrom('sales')
          .select(['payment_json', 'total_cents'])
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('branch_id', '=', currentSession.branch_id)
          .where('cash_session_id', '=', currentSession.id)
          .where('status', '=', 'COMPLETED')
          .execute();

        const cashMovements = await trx
          .selectFrom('cash_movements')
          .select(['type', 'amount_cents'])
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('cash_session_id', '=', currentSession.id)
          .execute();

        const expectedCashCents = calculateExpectedCashCents(
          currentSession.opening_amount_cents,
          salePayments,
          cashMovements
        );
        const diffCents = calculateDiffCents(expectedCashCents, payload.observed_cash_cents);

        const auditRecord = await trx
          .insertInto('cash_session_audits')
          .values({
            id: randomUUID(),
            tenant_id: request.auth!.tenantId,
            cash_session_id: currentSession.id,
            user_id: request.auth!.userId,
            observed_cash_cents: payload.observed_cash_cents,
            expected_cash_cents: expectedCashCents,
            diff_cents: diffCents,
            notes: payload.notes ?? null
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        await writeAuditLog(trx, {
          tenantId: request.auth!.tenantId,
          branchId: currentSession.branch_id,
          userId: request.auth!.userId,
          entityType: 'CASH_SESSION_AUDIT',
          entityId: auditRecord.id,
          action: 'CASH_SESSION_AUDITED',
          payloadJson: {
            cash_session_id: currentSession.id,
            observed_cash_cents: payload.observed_cash_cents,
            expected_cash_cents: expectedCashCents,
            diff_cents: diffCents,
            completed_sales_count: salePayments.length
          }
        });

        return { auditRecord, branch_id: currentSession.branch_id };
      });

      request.log.info(
        {
          ...buildRequestLogContext(request, {
            branchId: result.branch_id
          }),
          event: 'cash_session_audited',
          cash_session_id: params.id,
          diff_cents: result.auditRecord.diff_cents
        },
        'Cash session audited'
      );

      return reply.code(201).send({
        audit: result.auditRecord
      });
    }
  );

  typedApp.post(
    '/cash-sessions/:id/close',
    {
      preHandler: [app.requirePermissions(['cash:close'])],
      schema: {
        tags: ['cash-sessions'],
        security: [{ bearerAuth: [] }],
        params: closeCashSessionParamsSchema,
        body: closeCashSessionBodySchema
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const params = closeCashSessionParamsSchema.parse(request.params);
      const payload = closeCashSessionBodySchema.parse(request.body);

      const result = await app.db.transaction().execute(async (trx) => {
        const currentSession = await trx
          .selectFrom('cash_sessions')
          .select([
            'id',
            'tenant_id',
            'branch_id',
            'terminal_id',
            'opened_by_user_id',
            'opened_at',
            'opening_amount_cents',
            'closed_at',
            'closing_cash_real_cents',
            'expected_cash_cents',
            'diff_cents',
            'status'
          ])
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('id', '=', params.id)
          .forUpdate()
          .executeTakeFirst();

        if (!currentSession) {
          throw new AppError(404, 'CASH_SESSION_NOT_FOUND', 'Sesión de caja no encontrada');
        }

        if (
          request.auth!.role === 'CASHIER' &&
          currentSession.opened_by_user_id !== request.auth!.userId
        ) {
          throw new AppError(403, 'CASH_SESSION_FORBIDDEN', 'No puedes cerrar una caja abierta por otro cajero');
        }

        if (currentSession.closed_at) {
          throw new AppError(409, 'CASH_SESSION_ALREADY_CLOSED', 'La sesión de caja ya está cerrada');
        }

        const salePayments = await trx
          .selectFrom('sales')
          .select(['payment_json', 'total_cents'])
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('branch_id', '=', currentSession.branch_id)
          .where('cash_session_id', '=', currentSession.id)
          .where('status', '=', 'COMPLETED')
          .execute();

        const cashMovements = await trx
          .selectFrom('cash_movements')
          .select(['type', 'amount_cents'])
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('cash_session_id', '=', currentSession.id)
          .execute();

        const expectedCashCents = calculateExpectedCashCents(
          currentSession.opening_amount_cents,
          salePayments,
          cashMovements
        );
        const diffCents = calculateDiffCents(expectedCashCents, payload.closing_cash_real_cents);

        const updatedSession = await trx
          .updateTable('cash_sessions')
          .set({
            closed_at: new Date(),
            closing_cash_real_cents: payload.closing_cash_real_cents,
            expected_cash_cents: expectedCashCents,
            diff_cents: diffCents,
            status: 'CLOSED'
          })
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('id', '=', currentSession.id)
          .returning([
            'id',
            'tenant_id',
            'branch_id',
            'terminal_id',
            'opened_by_user_id',
            'opened_at',
            'status',
            'opening_amount_cents',
            'closed_at',
            'closing_cash_real_cents',
            'expected_cash_cents',
            'diff_cents'
          ])
          .executeTakeFirstOrThrow();

        if (diffCents !== 0) {
          await LedgerService.appendCashLedger(trx, {
            tenantId: request.auth!.tenantId,
            cashSessionId: updatedSession.id,
            terminalId: updatedSession.terminal_id,
            type: 'CLOSING_DISCREPANCY',
            amountCents: diffCents,
            balanceAfterCents: 0 // Simplificado para PoC
          });
        }

        // Emit alert if there is a significant mismatch (e.g., more than $5 / 500 cents)
        if (Math.abs(diffCents) >= 500) {
          await trx
            .insertInto('tenant_alerts')
            .values({
              tenant_id: request.auth!.tenantId,
              branch_id: updatedSession.branch_id,
              type: 'CASH_SESSION_MISMATCH',
              severity: 'CRITICAL',
              title: 'Descuadre de Caja Detectado',
              message: `La sesión de caja se cerró con un descuadre de ${diffCents / 100} en la terminal ${updatedSession.terminal_id}.`,
              metadata: JSON.stringify({
                cash_session_id: updatedSession.id,
                terminal_id: updatedSession.terminal_id,
                expected_cents: expectedCashCents,
                real_cents: payload.closing_cash_real_cents,
                diff_cents: diffCents
              }),
              status: 'UNREAD'
            })
            .execute();
        }

        await writeAuditLog(trx, {
          tenantId: request.auth!.tenantId,
          branchId: updatedSession.branch_id,
          userId: request.auth!.userId,
          entityType: 'CASH_SESSION',
          entityId: updatedSession.id,
          action: 'CASH_SESSION_CLOSED',
          payloadJson: {
            opening_amount_cents: updatedSession.opening_amount_cents,
            closing_cash_real_cents: updatedSession.closing_cash_real_cents,
            expected_cash_cents: expectedCashCents,
            diff_cents: diffCents,
            completed_sales_count: salePayments.length
          }
        });

        const methodRevenues: Record<string, number> = {
          CASH: 0,
          CARD: 0,
          TRANSFER: 0
        };

        let completedSalesTotalCents = 0;

        salePayments.forEach(sale => {
          completedSalesTotalCents += Number(sale.total_cents) || 0;
          const payment = sale.payment_json as Record<string, unknown> | null;
          if (!payment) return;

          if (payment.mode === 'MIXED' && Array.isArray(payment.payments)) {
            payment.payments.forEach((p: Record<string, unknown>) => {
              const method = p.method as string;
              if (methodRevenues[method] !== undefined) {
                methodRevenues[method] += Number(p.amount_cents) || 0;
              }
            });
          } else {
            const method = payment.mode as string;
            if (methodRevenues[method] !== undefined) {
              methodRevenues[method] += Number(payment.total_cents) || 0;
            }
          }
        });

        return {
          updatedSession,
          completedSalesCount: salePayments.length,
          completedSalesTotalCents,
          expectedCashCents,
          diffCents,
          methodRevenues
        };
      });

      request.log.info(
        {
          ...buildRequestLogContext(request, {
            branchId: result.updatedSession.branch_id
          }),
          event: 'cash_session_closed',
          cash_session_id: result.updatedSession.id,
          completed_sales_count: result.completedSalesCount,
          opening_amount_cents: result.updatedSession.opening_amount_cents,
          expected_cash_cents: result.expectedCashCents,
          closing_cash_real_cents: payload.closing_cash_real_cents,
          diff_cents: result.diffCents
        },
        'Cash session closed'
      );

      const isCashier = request.auth!.role === 'CASHIER';

      return {
        cash_session: mapCashSession(result.updatedSession),
        summary: {
          completed_sales_count: result.completedSalesCount,
          completed_sales_total_cents: result.completedSalesTotalCents,
          expected_cash_cents: isCashier ? 0 : result.expectedCashCents,
          diff_cents: isCashier ? 0 : result.diffCents,
          payment_breakdown: result.methodRevenues
        }
      };
    }
  );

  typedApp.get(
    '/cash-sessions/current',
    {
      preHandler: [app.requirePermissions(['cash:open'])],
      schema: {
        tags: ['cash-sessions'],
        security: [{ bearerAuth: [] }],
        querystring: currentCashSessionQuerySchema
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const query = currentCashSessionQuerySchema.parse(request.query);
      await assertTerminalBelongsToTenant(app, request.auth.tenantId, query.terminal_id);

      const currentSession = await app.db
        .selectFrom('cash_sessions')
        .select([
          'id',
          'tenant_id',
          'branch_id',
          'terminal_id',
          'opened_by_user_id',
          'opened_at',
          'opening_amount_cents',
          'closed_at',
          'closing_cash_real_cents',
          'expected_cash_cents',
          'diff_cents',
          'status'
        ])
        .where('tenant_id', '=', request.auth.tenantId)
        .where('terminal_id', '=', query.terminal_id)
        .where('status', '=', 'OPEN')
        .orderBy('opened_at', 'desc')
        .executeTakeFirst();

      return {
        cash_session: currentSession ? mapCashSession(currentSession) : null
      };
    }
  );

  typedApp.post(
    '/cash-sessions/:id/movements',
    {
      preHandler: [app.requirePermissions(['cash:move'])],
      schema: {
        tags: ['cash-sessions'],
        security: [{ bearerAuth: [] }],
        params: closeCashSessionParamsSchema,
        body: cashMovementBodySchema
      }
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const params = closeCashSessionParamsSchema.parse(request.params);
      const payload = cashMovementBodySchema.parse(request.body);

      const createdMovement = await app.db.transaction().execute(async (trx) => {
        const session = await trx
          .selectFrom('cash_sessions')
          .select(['id', 'closed_at', 'branch_id', 'opened_by_user_id', 'terminal_id'])
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('id', '=', params.id)
          .executeTakeFirst();

        if (!session) {
          throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada');
        }

        if (
          request.auth!.role === 'CASHIER' &&
          session.opened_by_user_id !== request.auth!.userId
        ) {
          throw new AppError(403, 'CASH_SESSION_FORBIDDEN', 'No puedes registrar movimientos en una caja abierta por otro cajero');
        }

        if (session.closed_at) {
          throw new AppError(400, 'SESSION_CLOSED', 'La sesión ya está cerrada');
        }

        ensureUserCanAccessBranch(request.auth, session.branch_id);

        const movement = await trx
          .insertInto('cash_movements')
          .values({
            id: randomUUID(),
            tenant_id: request.auth!.tenantId,
            cash_session_id: session.id,
            user_id: request.auth!.userId,
            type: payload.type,
            amount_cents: payload.amount_cents,
            reason: payload.reason
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        await LedgerService.appendCashLedger(trx, {
          tenantId: request.auth!.tenantId,
          cashSessionId: session.id,
          terminalId: session.terminal_id,
          type: payload.type === 'IN' ? 'MANUAL_IN' : 'MANUAL_OUT',
          amountCents: payload.type === 'IN' ? payload.amount_cents : -payload.amount_cents,
          balanceAfterCents: 0
        });

        await writeAuditLog(trx, {
          tenantId: request.auth!.tenantId,
          branchId: session.branch_id,
          userId: request.auth!.userId,
          entityType: 'CASH_SESSION',
          entityId: session.id,
          action: payload.type === 'IN' ? 'CASH_MOVEMENT_IN' : 'CASH_MOVEMENT_OUT',
          payloadJson: movement
        });

        return movement;
      });

      return reply.code(201).send({ movement: createdMovement });
    }
  );

  const reconcileCashSessionBodySchema = z.object({
    resolution_notes: z.string().optional()
  });

  typedApp.post(
    '/cash-sessions/:id/reconcile',
    {
      preHandler: [app.requirePermissions(['cash:audit'])],
      schema: {
        tags: ['cash-sessions'],
        security: [{ bearerAuth: [] }],
        params: closeCashSessionParamsSchema,
        body: reconcileCashSessionBodySchema
      }
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const params = closeCashSessionParamsSchema.parse(request.params);
      const payload = reconcileCashSessionBodySchema.parse(request.body);

      const result = await app.db.transaction().execute(async (trx) => {
        const currentSession = await trx
          .selectFrom('cash_sessions')
          .select([
            'id',
            'status',
            'branch_id',
            'closing_cash_real_cents',
            'expected_cash_cents',
            'diff_cents'
          ])
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('id', '=', params.id)
          .forUpdate()
          .executeTakeFirst();

        if (!currentSession) {
          throw new AppError(404, 'CASH_SESSION_NOT_FOUND', 'Sesión de caja no encontrada');
        }

        ensureUserCanAccessBranch(request.auth, currentSession.branch_id);

        if (currentSession.status !== 'CLOSED') {
          throw new AppError(400, 'SESSION_NOT_CLOSED', 'La sesión debe estar cerrada para conciliarse');
        }

        const reconciliation = await trx
          .insertInto('cash_reconciliations')
          .values({
            id: randomUUID(),
            tenant_id: request.auth!.tenantId,
            cash_session_id: currentSession.id,
            reconciled_by_user_id: request.auth!.userId,
            final_cash_cents: currentSession.closing_cash_real_cents ?? 0,
            system_expected_cents: currentSession.expected_cash_cents ?? 0,
            discrepancy_cents: currentSession.diff_cents ?? 0,
            resolution_notes: payload.resolution_notes ?? null
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        await trx
          .updateTable('cash_sessions')
          .set({ status: 'RECONCILED' })
          .where('id', '=', currentSession.id)
          .execute();

        return reconciliation;
      });

      return reply.code(201).send({ reconciliation: result });
    }
  );
  typedApp.get(
    '/cash-sessions/:id/z-report',
    {
      preHandler: [app.requirePermissions(['reports:view'])],
      schema: {
        tags: ['cash-sessions'],
        security: [{ bearerAuth: [] }],
        params: closeCashSessionParamsSchema
      }
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const params = closeCashSessionParamsSchema.parse(request.params);

      const session = await app.db
        .selectFrom('cash_sessions')
        .select([
          'id', 'tenant_id', 'branch_id', 'terminal_id', 'opened_by_user_id',
          'opened_at', 'opening_amount_cents', 'closed_at', 'closing_cash_real_cents',
          'expected_cash_cents', 'diff_cents', 'status'
        ])
        .where('tenant_id', '=', request.auth.tenantId)
        .where('id', '=', params.id)
        .executeTakeFirst();

      if (!session) {
        throw new AppError(404, 'CASH_SESSION_NOT_FOUND', 'Sesión de caja no encontrada');
      }

      ensureUserCanAccessBranch(request.auth, session.branch_id);

      const salePayments = await app.db
        .selectFrom('sales')
        .select(['payment_json', 'total_cents'])
        .where('tenant_id', '=', request.auth.tenantId)
        .where('branch_id', '=', session.branch_id)
        .where('cash_session_id', '=', session.id)
        .where('status', '=', 'COMPLETED')
        .execute();

      const cashMovements = await app.db
        .selectFrom('cash_movements')
        .select(['type', 'amount_cents'])
        .where('tenant_id', '=', request.auth.tenantId)
        .where('cash_session_id', '=', session.id)
        .execute();

      let completedSalesTotalCents = 0;
      const methodRevenues: Record<string, number> = {
        CASH: 0,
        CARD: 0,
        TRANSFER: 0
      };

      salePayments.forEach(sale => {
        completedSalesTotalCents += Number(sale.total_cents) || 0;
        const payment = sale.payment_json as Record<string, unknown> | null;
        if (!payment) return;

        if (payment.mode === 'MIXED' && Array.isArray(payment.payments)) {
          payment.payments.forEach((p: Record<string, unknown>) => {
            const method = p.method as string;
            if (methodRevenues[method] !== undefined) {
              methodRevenues[method] += Number(p.amount_cents) || 0;
            }
          });
        } else {
          const method = payment.mode as string;
          if (methodRevenues[method] !== undefined) {
            methodRevenues[method] += Number(payment.total_cents) || 0;
          }
        }
      });

      return reply.code(200).send({
        cash_session: mapCashSession(session),
        summary: {
          completed_sales_count: salePayments.length,
          completed_sales_total_cents: completedSalesTotalCents,
          expected_cash_cents: session.expected_cash_cents ?? 0,
          diff_cents: session.diff_cents ?? 0,
          payment_breakdown: methodRevenues,
          cash_movements: cashMovements.reduce((acc, mov) => {
            if (mov.type === 'IN') acc.in += mov.amount_cents;
            if (mov.type === 'OUT') acc.out += mov.amount_cents;
            return acc;
          }, { in: 0, out: 0 })
        }
      });
    }
  );
};

