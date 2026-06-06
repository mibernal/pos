import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomUUID } from 'crypto';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';

export const platformRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // All routes require PLATFORM_OWNER role
  app.addHook('onRequest', app.requirePlatformOwner);

  // GET /platform/tenants
  typedApp.get('/platform/tenants', {
    schema: {
      tags: ['Platform'],
      summary: 'List all tenants',
      response: {
        200: z.object({
          data: z.array(z.object({
            id: z.string(),
            name: z.string(),
            business_name: z.string(),
            nit: z.string(),
            status: z.string(),
            plan: z.string(),
            created_at: z.string()
          }))
        })
      }
    }
  }, async (request, reply) => {
    const tenants = await app.db.selectFrom('tenants')
      .select([
        'id', 'name', 'business_name', 'nit',
        'status', 'plan', 'created_at'
      ])
      .orderBy('created_at', 'desc')
      .execute();

    return { data: tenants.map(t => ({ ...t, created_at: t.created_at.toISOString() })) };
  });

  // PATCH /platform/tenants/:id/status
  typedApp.patch('/platform/tenants/:id/status', {
    schema: {
      tags: ['Platform'],
      summary: 'Suspend or activate a tenant',
      params: z.object({
        id: z.string()
      }),
      body: z.object({
        status: z.enum(['ACTIVE', 'SUSPENDED']),
        reason: z.string().optional()
      })
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const { status, reason } = request.body;

    const tenant = await app.db.selectFrom('tenants').where('id', '=', id).selectAll().executeTakeFirst();
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant no encontrado');

    await app.db.updateTable('tenants')
      .set({
        status,
        suspended_at: status === 'SUSPENDED' ? new Date() : null,
        suspended_reason: status === 'SUSPENDED' ? (reason || null) : null
      })
      .where('id', '=', id)
      .execute();

    await writeAuditLog(app.db, {
      tenantId: id,
      userId: request.auth!.userId,
      entityType: 'TENANT',
      entityId: id,
      action: status === 'SUSPENDED' ? 'TENANT_SUSPENDED' : 'TENANT_ACTIVATED',
      payloadJson: {
          previous: { status: tenant.status },
          current: { status, reason }
      }
    });

    return { success: true };
  });

  // GET /platform/metrics
  typedApp.get('/platform/metrics', {
    schema: {
      tags: ['Platform'],
      summary: 'Global metrics across all tenants'
    }
  }, async (request, reply) => {
    const tenantsCount = await app.db.selectFrom('tenants')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .executeTakeFirst();
      
    const usersCount = await app.db.selectFrom('users')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('active', '=', true)
      .executeTakeFirst();

    return {
      data: {
        total_tenants: Number(tenantsCount?.count || 0),
        active_users: Number(usersCount?.count || 0)
      }
    };
  });
  
  // POST /platform/tenants/:id/impersonate
  typedApp.post('/platform/tenants/:id/impersonate', {
    schema: {
      tags: ['Platform'],
      summary: 'Impersonate a tenant owner',
      params: z.object({
        id: z.string()
      }),
      body: z.object({
        reason: z.string()
      })
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const { reason } = request.body;

    const tenant = await app.db.selectFrom('tenants').where('id', '=', id).selectAll().executeTakeFirst();
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant no encontrado');
    
    if (!tenant.owner_user_id) {
        throw new AppError(400, 'BAD_REQUEST', 'El tenant no tiene un propietario asignado');
    }

    const owner = await app.db.selectFrom('users').where('id', '=', tenant.owner_user_id).selectAll().executeTakeFirst();
    if (!owner || !owner.active) {
        throw new AppError(400, 'BAD_REQUEST', 'El propietario del tenant no está activo o no existe');
    }

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await app.db.insertInto('impersonation_sessions').values({
      id: sessionId,
      platform_user_id: request.auth!.userId,
      target_user_id: owner.id,
      target_tenant_id: id,
      reason,
      expires_at: expiresAt
    }).execute();

    await writeAuditLog(app.db, {
      tenantId: id,
      userId: request.auth!.userId,
      entityType: 'USER',
      entityId: owner.id,
      action: 'USER_IMPERSONATED',
      payloadJson: { session_id: sessionId, reason }
    });

    return { success: true, session_id: sessionId, message: 'Implementar generación de JWT para impersonación' };
  });
};
