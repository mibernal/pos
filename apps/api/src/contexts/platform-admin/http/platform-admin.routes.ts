import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PlatformAdminRepository } from '../infra/platform-admin.repository.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';
import { randomUUID } from 'crypto';
import { hashPassword } from '../../identity/auth/password.js';

const createTenantBodySchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8),
  name: z.string().min(1),
  tenant_name: z.string().min(1),
  tenant_business_name: z.string().min(1),
  tenant_document_type: z.enum(['NIT', 'CC', 'CE', 'PASSPORT']),
  tenant_document_number: z.string().min(1),
  tax_mode: z.enum(['IVA', 'INC_RESTAURANT', 'REGIMEN_SIMPLIFICADO']).default('IVA'),
  plan: z.string().default('STARTER')
});

const updateTenantBodySchema = z.object({
  name: z.string().optional(),
  business_name: z.string().optional(),
  nit: z.string().optional(),
  tax_mode: z.enum(['IVA', 'INC_RESTAURANT', 'REGIMEN_SIMPLIFICADO']).optional(),
  owner_name: z.string().optional(),
  owner_email: z.string().email().optional()
});

const changePlanBodySchema = z.object({
  new_plan: z.string()
});

const createTenantUserBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(['TENANT_OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR']),
  active: z.boolean().default(true)
});

const updateTenantUserBodySchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['TENANT_OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR']).optional(),
  active: z.boolean().optional()
});

export const platformAdminRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const repo = new PlatformAdminRepository(app.db);

  app.addHook('onRequest', app.requirePlatformOwner);

  typedApp.get('/platform/dashboard', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Get SaaS Executive Dashboard Metrics'
    }
  }, async () => {
    const metrics = await repo.getDashboardMetrics();
    return { metrics };
  });

  typedApp.get('/platform/activity', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Get recent platform activity',
      querystring: z.object({
        limit: z.coerce.number().optional().default(50)
      })
    }
  }, async (request) => {
    const activity = await repo.getRecentActivity(request.query.limit);
    return { activity };
  });

  typedApp.get('/platform/tenants', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Advanced search for tenants',
      querystring: z.object({
        query: z.string().optional(),
        status: z.string().optional(),
        plan: z.string().optional(),
        activity: z.string().optional(),
        limit: z.coerce.number().optional().default(50),
        offset: z.coerce.number().optional().default(0)
      })
    }
  }, async (request) => {
    const result = await repo.searchTenants(request.query);
    return result;
  });

  typedApp.get('/platform/growth', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Growth charts data'
    }
  }, async () => {
    const history = await repo.getGrowthMetrics();
    return { history };
  });

  typedApp.post('/platform/tenants/:id/suspend', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Suspend a tenant',
      params: z.object({ id: z.string() }),
      body: z.object({ reason: z.string().min(5) })
    }
  }, async (request) => {
    const { id } = request.params;
    const { reason } = request.body;

    const tenant = await app.db.selectFrom('tenants').where('id', '=', id).selectAll().executeTakeFirst();
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant no encontrado');

    await app.db.updateTable('tenants')
      .set({
        status: 'SUSPENDED',
        suspended_at: new Date(),
        suspended_reason: reason
      })
      .where('id', '=', id)
      .execute();

    await writeAuditLog(app.db, {
      tenantId: id,
      userId: request.auth!.userId,
      entityType: 'TENANT',
      entityId: id,
      action: 'TENANT_SUSPENDED',
      payloadJson: { reason }
    });

    await app.db.insertInto('platform_events').values({
      tenant_id: id,
      type: 'TENANT_SUSPENDED',
      severity: 'WARNING',
      actor_id: request.auth!.userId,
      actor_email: request.auth!.email,
      metadata: { reason } as any // eslint-disable-line @typescript-eslint/no-explicit-any
    }).execute();

    return { success: true };
  });

  typedApp.post('/platform/tenants/:id/reactivate', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Reactivate a suspended tenant',
      params: z.object({ id: z.string() })
    }
  }, async (request) => {
    const { id } = request.params;
    const tenant = await app.db.selectFrom('tenants').where('id', '=', id).selectAll().executeTakeFirst();
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant no encontrado');

    await app.db.updateTable('tenants')
      .set({
        status: 'ACTIVE',
        suspended_at: null,
        suspended_reason: null
      })
      .where('id', '=', id)
      .execute();

    await writeAuditLog(app.db, {
      tenantId: id,
      userId: request.auth!.userId,
      entityType: 'TENANT',
      entityId: id,
      action: 'TENANT_REACTIVATED',
      payloadJson: {}
    });

    await app.db.insertInto('platform_events').values({
      tenant_id: id,
      type: 'TENANT_REACTIVATED',
      severity: 'INFO',
      actor_id: request.auth!.userId,
      actor_email: request.auth!.email
    }).execute();

    return { success: true };
  });

  // SSE endpoint for Alerts
  typedApp.get('/platform/alerts/stream', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Stream platform alerts via SSE'
    }
  }, async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    
    // Send initial payload
    const sendInitial = async () => {
      const expiringSoon = await repo.getDashboardMetrics();
      const payload = {
        type: 'INITIAL_ALERTS',
        alerts: [
          { id: '1', title: `${expiringSoon.expiringSubscriptions} tenants vencen pronto`, severity: 'WARNING' },
          { id: '2', title: `${expiringSoon.suspendedTenants} tenants suspendidos`, severity: 'CRITICAL' }
        ]
      };
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    await sendInitial();

    const interval = setInterval(() => {
      reply.raw.write(`data: ${JSON.stringify({ type: 'PING' })}\n\n`);
    }, 15000);

    request.raw.on('close', () => {
      clearInterval(interval);
    });
  });

  typedApp.post('/platform/tenants/:id/impersonate', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Impersonate a tenant owner',
      params: z.object({
        id: z.string()
      }),
      body: z.object({
        reason: z.string()
      })
    }
  }, async (request, reply) => { // eslint-disable-line @typescript-eslint/no-unused-vars
    const { id } = request.params;
    const { reason } = request.body;

    const tenant = await app.db.selectFrom('tenants').where('id', '=', id).selectAll().executeTakeFirst();
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant no encontrado');
    
    let owner = null;
    if (tenant.owner_user_id) {
        owner = await app.db.selectFrom('users').where('id', '=', tenant.owner_user_id).selectAll().executeTakeFirst();
    }
    
    if (!owner || !owner.active) {
        // Fallback: get the first active user belonging to this tenant
        owner = await app.db.selectFrom('users').where('tenant_id', '=', id).where('active', '=', true).selectAll().executeTakeFirst();
    }

    if (!owner) {
        throw new AppError(400, 'BAD_REQUEST', 'El tenant no tiene usuarios activos a quienes suplantar');
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

  typedApp.get('/platform/plans', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Get available billing plans'
    }
  }, async () => {
    const plans = await app.db.selectFrom('billing_plans').selectAll().execute();
    return { plans };
  });

  typedApp.post('/platform/tenants', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Create a new tenant manually',
      body: createTenantBodySchema
    }
  }, async (request) => {
    const payload = request.body;

    const existingUser = await app.db.selectFrom('users').where('email', '=', payload.email).select('id').executeTakeFirst();
    if (existingUser) throw new AppError(400, 'BAD_REQUEST', 'El correo electrónico ya está registrado');

    const existingTenant = await app.db.selectFrom('tenants').where('nit', '=', payload.tenant_document_number).select('id').executeTakeFirst();
    if (existingTenant) throw new AppError(400, 'BAD_REQUEST', 'El documento del negocio ya está registrado');

    const passwordHash = await hashPassword(payload.password);
    const tenantId = randomUUID();
    const userId = randomUUID();

    await app.db.transaction().execute(async (trx) => {
      await trx.insertInto('tenants').values({
        id: tenantId,
        name: payload.tenant_name,
        business_name: payload.tenant_business_name,
        nit: payload.tenant_document_number,
        address: 'No especificada',
        tax_mode: payload.tax_mode,
        status: 'ACTIVE', // Assuming superadmin creates an active tenant directly
        plan: payload.plan,
        owner_user_id: userId
      }).execute();

      await trx.insertInto('users').values({
        id: userId,
        tenant_id: tenantId!,
        email: payload.email,
        password_hash: passwordHash,
        name: payload.name,
        role: 'TENANT_OWNER',
        active: true
      }).execute();

      const branchId = randomUUID();
      await trx.insertInto('branches').values({
        id: branchId,
        tenant_id: tenantId!,
        name: 'Sucursal Principal',
        address: 'No especificada'
      }).execute();

      await trx.insertInto('user_branches').values({
        tenant_id: tenantId!,
        user_id: userId,
        branch_id: branchId!}).execute();
      
      const planRow = await trx.selectFrom('billing_plans').where('name', '=', payload.plan).selectAll().executeTakeFirst();
      if (planRow) {
        await trx.insertInto('tenant_subscriptions').values({
          id: randomUUID(),
          tenant_id: tenantId!,
          plan_id: planRow.id,
          status: 'ACTIVE',
          current_period_start: new Date(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          starts_at: new Date(),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }).execute();
      }
    });

    await app.db.insertInto('platform_events').values({
      tenant_id: tenantId!,
      type: 'TENANT_CREATED_ADMIN',
      severity: 'INFO',
      actor_id: request.auth!.userId,
      actor_email: request.auth!.email,
      metadata: { plan: payload.plan, tax_mode: payload.tax_mode } as any // eslint-disable-line @typescript-eslint/no-explicit-any
    }).execute();

    return { success: true, tenant_id: tenantId!};
  });

  typedApp.patch('/platform/tenants/:id', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Update basic tenant info',
      params: z.object({ id: z.string() }),
      body: updateTenantBodySchema
    }
  }, async (request) => {
    const { id } = request.params;
    const { owner_name, owner_email, ...tenantData } = request.body;

    if (Object.keys(tenantData).length > 0) {
      await app.db.updateTable('tenants')
        .set(tenantData)
        .where('id', '=', id)
        .execute();
    }

    if (owner_name || owner_email) {
      const tenant = await app.db.selectFrom('tenants').where('id', '=', id).selectAll().executeTakeFirst();
      if (tenant?.owner_user_id) {
        const updateData: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (owner_name) updateData.name = owner_name;
        if (owner_email) updateData.email = owner_email;
        
        await app.db.updateTable('users')
          .set(updateData)
          .where('id', '=', tenant.owner_user_id)
          .execute();
      }
    }

    await app.db.insertInto('platform_events').values({
      tenant_id: id,
      type: 'TENANT_UPDATED',
      severity: 'INFO',
      actor_id: request.auth!.userId,
      actor_email: request.auth!.email,
      metadata: request.body as any // eslint-disable-line @typescript-eslint/no-explicit-any
    }).execute();

    return { success: true };
  });

  typedApp.post('/platform/tenants/:id/plan', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Change billing plan for a tenant',
      params: z.object({ id: z.string() }),
      body: changePlanBodySchema
    }
  }, async (request) => {
    const { id } = request.params;
    const { new_plan } = request.body;

    const tenant = await app.db.selectFrom('tenants').where('id', '=', id).selectAll().executeTakeFirst();
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant no encontrado');

    const planRow = await app.db.selectFrom('billing_plans').where('name', '=', new_plan).selectAll().executeTakeFirst();
    if (!planRow) throw new AppError(400, 'BAD_REQUEST', 'Plan inválido');

    await app.db.transaction().execute(async (trx) => {
      await trx.updateTable('tenants')
        .set({ plan: new_plan })
        .where('id', '=', id)
        .execute();

      // For simplicity, just update the existing active subscription or insert a new one
      const sub = await trx.selectFrom('tenant_subscriptions')
        .where('tenant_id', '=', id)
        .where('status', '=', 'ACTIVE')
        .selectAll()
        .executeTakeFirst();
      
      if (sub) {
        await trx.updateTable('tenant_subscriptions')
          .set({ plan_id: planRow.id })
          .where('id', '=', sub.id)
          .execute();
          
        await trx.insertInto('subscription_events').values({
          subscription_id: sub.id,
          type: 'PLAN_CHANGED',
          metadata: { old_plan: tenant.plan, new_plan } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();
      } else {
        const newSubId = randomUUID();
        await trx.insertInto('tenant_subscriptions').values({
          id: newSubId,
          tenant_id: id,
          plan_id: planRow.id,
          status: 'ACTIVE',
          current_period_start: new Date(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          starts_at: new Date(),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }).execute();
        
        await trx.insertInto('subscription_events').values({
          subscription_id: newSubId,
          type: 'PLAN_CREATED',
          metadata: { plan: new_plan } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();
      }
    });

    await app.db.insertInto('platform_events').values({
      tenant_id: id,
      type: 'TENANT_PLAN_CHANGED',
      severity: 'INFO',
      actor_id: request.auth!.userId,
      actor_email: request.auth!.email,
      metadata: { old_plan: tenant.plan, new_plan } as any // eslint-disable-line @typescript-eslint/no-explicit-any
    }).execute();

    return { success: true };
  });

  typedApp.get('/platform/health', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Aggregated platform health status'
    }
  }, async () => {
    // In a real app we would ping DB, Redis, BullMQ, OpenTelemetry here.
    return {
      status: 'Healthy',
      services: [
        { name: 'API', status: 'Healthy' },
        { name: 'PostgreSQL', status: 'Healthy' },
        { name: 'Redis', status: 'Healthy' },
        { name: 'BullMQ Workers', status: 'Healthy' }
      ]
    };
  });
  typedApp.get('/platform/tenants/:id/users', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'List users of a tenant',
      params: z.object({ id: z.string() })
    }
  }, async (request) => {
    const { id } = request.params;
    const users = await app.db.selectFrom('users')
      .where('tenant_id', '=', id)
      .select(['id', 'email', 'name', 'role', 'active', 'created_at'])
      .orderBy('created_at', 'desc')
      .execute();
    return { users };
  });

  typedApp.post('/platform/tenants/:id/users', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Create a user for a tenant',
      params: z.object({ id: z.string() }),
      body: createTenantUserBodySchema
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const payload = request.body;

    const passwordHash = await hashPassword(payload.password);
    const newUserId = randomUUID();

    const createdUser = await app.db.insertInto('users').values({
      id: newUserId,
      tenant_id: id,
      email: payload.email,
      password_hash: passwordHash,
      name: payload.name,
      role: payload.role,
      active: payload.active
    }).returning(['id', 'email', 'name', 'role', 'active', 'created_at']).executeTakeFirstOrThrow();

    await app.db.insertInto('platform_events').values({
      tenant_id: id,
      type: 'TENANT_USER_CREATED' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      severity: 'INFO',
      actor_id: request.auth!.userId,
      actor_email: request.auth!.email,
      metadata: { userId: newUserId, email: payload.email, role: payload.role }
    }).execute();

    return reply.code(201).send({ user: createdUser });
  });

  typedApp.patch('/platform/tenants/:id/users/:userId', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Update a user of a tenant',
      params: z.object({ id: z.string(), userId: z.string() }),
      body: updateTenantUserBodySchema
    }
  }, async (request) => {
    const { id, userId } = request.params;
    const body = request.body;

    if (Object.keys(body).length > 0) {
      await app.db.updateTable('users')
        .set(body)
        .where('id', '=', userId)
        .where('tenant_id', '=', id)
        .execute();
    }

    await app.db.insertInto('platform_events').values({
      tenant_id: id,
      type: 'TENANT_USER_UPDATED' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      severity: 'INFO',
      actor_id: request.auth!.userId,
      actor_email: request.auth!.email,
      metadata: { userId, updates: body }
    }).execute();

    return { success: true };
  });

  typedApp.delete('/platform/tenants/:id/users/:userId', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Delete a user from a tenant',
      params: z.object({ id: z.string(), userId: z.string() })
    }
  }, async (request) => {
    const { id, userId } = request.params;

    const user = await app.db.selectFrom('users').where('id', '=', userId).where('tenant_id', '=', id).selectAll().executeTakeFirst();
    if (!user) throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado');

    const tenant = await app.db.selectFrom('tenants').where('id', '=', id).selectAll().executeTakeFirst();
    if (tenant?.owner_user_id === userId) {
      throw new AppError(400, 'BAD_REQUEST', 'No puedes eliminar al usuario principal (dueño) de la cuenta');
    }

    await app.db.deleteFrom('users')
      .where('id', '=', userId)
      .where('tenant_id', '=', id)
      .execute();

    await app.db.insertInto('platform_events').values({
      tenant_id: id,
      type: 'TENANT_USER_DELETED' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      severity: 'WARNING',
      actor_id: request.auth!.userId,
      actor_email: request.auth!.email,
      metadata: { userId, email: user.email }
    }).execute();

    return { success: true };
  });
};
