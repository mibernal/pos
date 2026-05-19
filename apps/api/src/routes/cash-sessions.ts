import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../infra/errors/app-error.js';
import {
  calculateDiffCents,
  calculateExpectedCashCents
} from '../domain/cash-sessions-service.js';
import { writeAuditLog } from '../domain/audit/write-audit-log.js';
import { buildRequestLogContext } from '../infra/logging/request-log-context.js';

const openCashSessionBodySchema = z.object({
  branch_id: z.string().uuid(),
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
  branch_id: z.string().uuid()
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
    opened_by_user_id: string;
    opened_at: Date;
    opening_amount_cents: number;
    closed_at: Date | null;
    closing_cash_real_cents: number | null;
    expected_cash_cents: number | null;
    diff_cents: number | null;
  }
) {
  return {
    id: session.id,
    tenant_id: session.tenant_id,
    branch_id: session.branch_id,
    opened_by_user_id: session.opened_by_user_id,
    opened_at: session.opened_at.toISOString(),
    opening_amount_cents: session.opening_amount_cents,
    closed_at: session.closed_at ? session.closed_at.toISOString() : null,
    closing_cash_real_cents: session.closing_cash_real_cents,
    expected_cash_cents: session.expected_cash_cents,
    diff_cents: session.diff_cents
  };
}

async function assertBranchBelongsToTenant(
  app: Parameters<FastifyPluginAsync>[0],
  tenantId: string,
  branchId: string
): Promise<void> {
  const branch = await app.db
    .selectFrom('branches')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('id', '=', branchId)
    .executeTakeFirst();

  if (!branch) {
    throw new AppError(400, 'BRANCH_NOT_FOUND', 'La sucursal no existe para este tenant');
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
      preHandler: [app.requireRoles(['ADMIN', 'MANAGER', 'CASHIER'])],
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
      await assertBranchBelongsToTenant(app, request.auth.tenantId, payload.branch_id);

      const existingOpenSession = await app.db
        .selectFrom('cash_sessions')
        .select('id')
        .where('tenant_id', '=', request.auth.tenantId)
        .where('branch_id', '=', payload.branch_id)
        .where('closed_at', 'is', null)
        .executeTakeFirst();

      if (existingOpenSession) {
        throw new AppError(
          409,
          'CASH_SESSION_ALREADY_OPEN',
          'Ya existe una caja abierta para esta sucursal'
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
              opened_by_user_id: request.auth!.userId,
              opening_amount_cents: payload.opening_amount_cents
            })
            .returning([
              'id',
              'tenant_id',
              'branch_id',
              'opened_by_user_id',
              'opened_at',
              'opening_amount_cents',
              'closed_at',
              'closing_cash_real_cents',
              'expected_cash_cents',
              'diff_cents'
            ])
            .executeTakeFirstOrThrow();

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
            'Ya existe una caja abierta para esta sucursal'
          );
        }
        throw error;
      }

      request.log.info(
        {
          ...buildRequestLogContext(request, {
            branchId: payload.branch_id
          }),
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
      preHandler: [app.requireRoles(['ADMIN', 'MANAGER'])],
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
      preHandler: [app.requireRoles(['ADMIN', 'MANAGER', 'CASHIER'])],
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
            'opened_by_user_id',
            'opened_at',
            'opening_amount_cents',
            'closed_at',
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
            diff_cents: diffCents
          })
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('id', '=', currentSession.id)
          .returning([
            'id',
            'tenant_id',
            'branch_id',
            'opened_by_user_id',
            'opened_at',
            'opening_amount_cents',
            'closed_at',
            'closing_cash_real_cents',
            'expected_cash_cents',
            'diff_cents'
          ])
          .executeTakeFirstOrThrow();

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

        return {
          updatedSession,
          completedSalesCount: salePayments.length,
          expectedCashCents,
          diffCents
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
          expected_cash_cents: isCashier ? 0 : result.expectedCashCents,
          diff_cents: isCashier ? 0 : result.diffCents
        }
      };
    }
  );

  typedApp.get(
    '/cash-sessions/current',
    {
      preHandler: [app.requireRoles(['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR'])],
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
      await assertBranchBelongsToTenant(app, request.auth.tenantId, query.branch_id);

      const currentSession = await app.db
        .selectFrom('cash_sessions')
        .select([
          'id',
          'tenant_id',
          'branch_id',
          'opened_by_user_id',
          'opened_at',
          'opening_amount_cents',
          'closed_at',
          'closing_cash_real_cents',
          'expected_cash_cents',
          'diff_cents'
        ])
        .where('tenant_id', '=', request.auth.tenantId)
        .where('branch_id', '=', query.branch_id)
        .where('closed_at', 'is', null)
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
      preHandler: [app.requireRoles(['ADMIN', 'MANAGER', 'CASHIER'])],
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
          .select(['id', 'closed_at', 'branch_id'])
          .where('tenant_id', '=', request.auth!.tenantId)
          .where('id', '=', params.id)
          .executeTakeFirst();

        if (!session) {
          throw new AppError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada');
        }
        if (session.closed_at) {
          throw new AppError(400, 'SESSION_CLOSED', 'La sesión ya está cerrada');
        }

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
};
