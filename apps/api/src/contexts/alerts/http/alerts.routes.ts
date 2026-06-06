import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getAlertsQuerySchema, resolveAlertSchema } from '@pos-dian/shared';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { sql } from 'kysely';
import { setupSseStream } from '../../../shared/infra/security/sse-limits.js';

export const alertsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // SSE Stream
  app.get(
    '/alerts/stream',
    {
      preHandler: [app.requirePermissions(['alerts:view'])]
    },
    (request, reply) => {
      if (!request.auth) return reply.code(401).send({ message: 'No autorizado' });

      const stream = setupSseStream(request, reply);
      if (!stream) return;

      const pushAlert = (alertData: any) => {
        stream.writeEvent(alertData);
      };

      // Since we don't have Redis configured yet for PubSub, we will simulate SSE push
      // by periodically checking for new UNREAD alerts, or ideally, we'd hook into an EventEmitter.
      // For a robust implementation we need PG-Listen or Redis. We will poll DB as a fallback for now.
      // Optimization: Only poll every 5s if active.
      let lastCheck = new Date();
      
      const pollAlerts = async () => {
        if (!stream.isActive()) return;
        try {
          // Find alerts created after lastCheck
          let query = app.db
            .selectFrom('tenant_alerts')
            .where('tenant_id', '=', request.auth!.tenantId)
            .where('status', '=', 'UNREAD')
            .where('created_at', '>', lastCheck);
            
          // If manager, filter by branches they can access
          if (request.auth!.role !== 'ADMIN' && request.auth!.role !== 'TENANT_OWNER' && !request.auth!.isPlatformRole) {
             query = query.where((eb) => 
               eb.or([
                 eb('branch_id', 'is', null),
                 eb('branch_id', 'in', request.auth!.branchIds)
               ])
             );
          }

          const newAlerts = await query.selectAll().execute();
          lastCheck = new Date();

          for (const alert of newAlerts) {
            pushAlert(alert);
          }
        } catch (err) {
          app.log.error(err, 'Alert polling error');
        }
      };

      const interval = setInterval(() => void pollAlerts(), 5000);

      request.raw.on('close', () => {
        clearInterval(interval);
      });
    }
  );

  // Get Alerts Inbox
  typedApp.get(
    '/alerts',
    {
      preHandler: [app.requirePermissions(['alerts:view'])],
      schema: {
        tags: ['alerts'],
        security: [{ bearerAuth: [] }],
        querystring: getAlertsQuerySchema
      }
    },
    async (request) => {
      if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'No autorizado');
      
      const { status, severity, limit, offset, branch_id } = request.query;

      let query = app.db
        .selectFrom('tenant_alerts')
        .where('tenant_id', '=', request.auth.tenantId);

      if (status) query = query.where('status', '=', status);
      if (severity) query = query.where('severity', '=', severity);
      
      if (branch_id) {
         if (!request.auth.branchIds.includes(branch_id as string) && request.auth.role !== 'ADMIN' && request.auth.role !== 'TENANT_OWNER' && !request.auth.isPlatformRole) {
            throw new AppError(403, 'FORBIDDEN', 'No autorizado para ver alertas de esta sucursal');
         }
         query = query.where('branch_id', '=', branch_id as string);
      } else if (request.auth.role !== 'ADMIN' && request.auth.role !== 'TENANT_OWNER' && !request.auth.isPlatformRole) {
         query = query.where((eb) => 
           eb.or([
             eb('branch_id', 'is', null),
             eb('branch_id', 'in', request.auth!.branchIds)
           ])
         );
      }

      const rows = await query
        .selectAll()
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset)
        .execute();

      return {
        items: rows.map(r => ({
          ...r,
          created_at: r.created_at.toISOString(),
          resolved_at: r.resolved_at?.toISOString() ?? null
        }))
      };
    }
  );

  // Resolve Alert
  typedApp.patch(
    '/alerts/:id/resolve',
    {
      preHandler: [app.requirePermissions(['alerts:manage'])],
      schema: {
        tags: ['alerts'],
        security: [{ bearerAuth: [] }],
        body: resolveAlertSchema
      }
    },
    async (request, reply) => {
      if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'No autorizado');
      const alertId = (request.params as { id: string }).id;
      
      const alert = await app.db
        .selectFrom('tenant_alerts')
        .where('id', '=', alertId)
        .where('tenant_id', '=', request.auth.tenantId)
        .selectAll()
        .executeTakeFirst();

      if (!alert) throw new AppError(404, 'NOT_FOUND', 'Alerta no encontrada');

      if (alert.branch_id && request.auth.role !== 'ADMIN' && request.auth.role !== 'TENANT_OWNER' && !request.auth.isPlatformRole && !request.auth.branchIds.includes(alert.branch_id)) {
         throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para resolver esta alerta');
      }

      const updated = await app.db
        .updateTable('tenant_alerts')
        .set({
          status: 'RESOLVED',
          resolved_at: new Date(),
          resolved_by_user_id: request.auth.userId,
          metadata: request.body.resolution_notes 
             ? sql`metadata || ${JSON.stringify({ resolution_notes: request.body.resolution_notes })}::jsonb`
             : undefined
        })
        .where('id', '=', alertId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
          ...updated,
          created_at: updated.created_at.toISOString(),
          resolved_at: updated.resolved_at?.toISOString() ?? null
      };
    }
  );
};
