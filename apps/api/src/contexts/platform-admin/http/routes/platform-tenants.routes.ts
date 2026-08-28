import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PlatformAdminRepository } from '../../infra/platform-admin.repository.js';
import { SearchTenantsUseCase } from '../../application/tenants/search-tenants.use-case.js';
import { SuspendTenantUseCase } from '../../application/tenants/suspend-tenant.use-case.js';
import { ReactivateTenantUseCase } from '../../application/tenants/reactivate-tenant.use-case.js';
import { ImpersonateTenantUseCase } from '../../application/tenants/impersonate-tenant.use-case.js';
import { CreateTenantUseCase } from '../../application/tenants/create-tenant.use-case.js';
import { UpdateTenantUseCase } from '../../application/tenants/update-tenant.use-case.js';
import { ChangeTenantPlanUseCase } from '../../application/tenants/change-tenant-plan.use-case.js';
import { UpdateTenantModulesUseCase } from '../../application/tenants/update-tenant-modules.use-case.js';
import { UpdateTenantModulesSchema } from '@pos-dian/shared';
import { invalidateDashboardCache } from '../../../../shared/infra/cache/invalidate-dashboard-cache.js';

const createTenantBodySchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8),
  name: z.string().min(1),
  tenant_name: z.string().min(1),
  tenant_business_name: z.string().min(1),
  tenant_document_type: z.enum(['NIT', 'CC', 'CE', 'PASSPORT']),
  tenant_document_number: z.string().min(1),
  tax_mode: z.enum(['IVA', 'INC_RESTAURANT', 'REGIMEN_SIMPLIFICADO']).default('IVA'),
  plan: z.string().default('STARTER'),
  business_type: z.enum(['RESTAURANT','CAFETERIA','BAKERY','FAST_FOOD','BAR','NIGHTCLUB','BUTCHER','MINIMARKET','SUPERMARKET','CORNER_STORE','HARDWARE_STORE','PHARMACY','STATIONERY','BOUTIQUE','OTHER']).default('OTHER'),
  custom_business_type: z.string().trim().min(2).max(80).nullable().optional(),
  enable_tables: z.boolean().optional(),
  enable_delivery: z.boolean().optional(),
  enable_waiters: z.boolean().optional(),
  enable_split_bill: z.boolean().optional(),
  enable_tips: z.boolean().optional(),
  enable_kitchen: z.boolean().optional(),
  enable_kitchen_display: z.boolean().optional(),
  enable_kitchen_tickets: z.boolean().optional(),
  enable_kitchen_printing: z.boolean().optional(),
  enable_order_rounds: z.boolean().optional(),
  enable_product_modifiers: z.boolean().optional(),
  enable_reservations: z.boolean().optional(),
  enable_waiter_shifts: z.boolean().optional(),
  enable_qr_menu: z.boolean().optional(),
  enable_guests_count: z.boolean().optional(),
  enable_restaurant: z.boolean().optional(),
  enable_kds: z.boolean().optional(),
  enable_inventory: z.boolean().optional(),
  enable_fiscal: z.boolean().optional(),
  enable_loyalty: z.boolean().optional(),
  enable_advanced_reports: z.boolean().optional()
});

const updateTenantBodySchema = z.object({
  name: z.string().optional(),
  business_name: z.string().optional(),
  nit: z.string().optional(),
  tax_mode: z.enum(['IVA', 'INC_RESTAURANT', 'REGIMEN_SIMPLIFICADO']).optional(),
  owner_name: z.string().optional(),
  owner_email: z.string().email().optional(),
  business_type: z.enum(['RESTAURANT','CAFETERIA','BAKERY','FAST_FOOD','BAR','NIGHTCLUB','BUTCHER','MINIMARKET','SUPERMARKET','CORNER_STORE','HARDWARE_STORE','PHARMACY','STATIONERY','BOUTIQUE','OTHER']).optional(),
  custom_business_type: z.string().trim().min(2).max(80).nullable().optional(),
  enable_tables: z.boolean().optional(),
  enable_delivery: z.boolean().optional(),
  enable_waiters: z.boolean().optional(),
  enable_split_bill: z.boolean().optional(),
  enable_tips: z.boolean().optional(),
  enable_kitchen: z.boolean().optional(),
  enable_kitchen_display: z.boolean().optional(),
  enable_kitchen_tickets: z.boolean().optional(),
  enable_kitchen_printing: z.boolean().optional(),
  enable_order_rounds: z.boolean().optional(),
  enable_product_modifiers: z.boolean().optional(),
  enable_reservations: z.boolean().optional(),
  enable_waiter_shifts: z.boolean().optional(),
  enable_qr_menu: z.boolean().optional(),
  enable_guests_count: z.boolean().optional(),
  enable_restaurant: z.boolean().optional(),
  enable_kds: z.boolean().optional(),
  enable_inventory: z.boolean().optional(),
  enable_fiscal: z.boolean().optional(),
  enable_loyalty: z.boolean().optional(),
  enable_advanced_reports: z.boolean().optional()
});

const changePlanBodySchema = z.object({
  new_plan: z.string()
});

export const platformTenantsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const repo = new PlatformAdminRepository(app.db);

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
    const useCase = new SearchTenantsUseCase(repo);
    return useCase.execute(request.query);
  });

  typedApp.post('/platform/tenants', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Create a new tenant manually',
      body: createTenantBodySchema
    }
  }, async (request) => {
    const useCase = new CreateTenantUseCase(app.db);
    const tenant_id = await useCase.execute(request.body as any, request.auth!.userId, request.auth!.email);
    await invalidateDashboardCache(app.redis);
    return { success: true, tenant_id };
  });

  typedApp.patch('/platform/tenants/:id', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Update basic tenant info',
      params: z.object({ id: z.string() }),
      body: updateTenantBodySchema
    }
  }, async (request) => {
    const useCase = new UpdateTenantUseCase(app.db);
    await useCase.execute(request.params.id, request.body as any, request.auth!.userId, request.auth!.email);
    await invalidateDashboardCache(app.redis);
    return { success: true };
  });

  typedApp.post('/platform/tenants/:id/suspend', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Suspend a tenant',
      params: z.object({ id: z.string() }),
      body: z.object({ reason: z.string().min(5) })
    }
  }, async (request) => {
    const useCase = new SuspendTenantUseCase(app.db);
    await useCase.execute(request.params.id, request.body.reason, request.auth!.userId, request.auth!.email);
    await invalidateDashboardCache(app.redis);
    return { success: true };
  });

  typedApp.post('/platform/tenants/:id/reactivate', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Reactivate a suspended tenant',
      params: z.object({ id: z.string() })
    }
  }, async (request) => {
    const useCase = new ReactivateTenantUseCase(app.db);
    await useCase.execute(request.params.id, request.auth!.userId, request.auth!.email);
    await invalidateDashboardCache(app.redis);
    return { success: true };
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
  }, async (request) => {
    const useCase = new ImpersonateTenantUseCase(app.db);
    const session_id = await useCase.execute(request.params.id, request.body.reason, request.auth!.userId);
    return { success: true, session_id, message: 'Implementar generación de JWT para impersonación' };
  });

  typedApp.post('/platform/tenants/:id/plan', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Change billing plan for a tenant',
      params: z.object({ id: z.string() }),
      body: changePlanBodySchema
    }
  }, async (request) => {
    const useCase = new ChangeTenantPlanUseCase(app.db);
    await useCase.execute(request.params.id, request.body.new_plan, request.auth!.userId, request.auth!.email);
    await invalidateDashboardCache(app.redis);
    return { success: true };
  });

  typedApp.patch('/platform/tenants/:id/modules', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Update feature modules for a tenant',
      params: z.object({ id: z.string() }),
      body: UpdateTenantModulesSchema
    }
  }, async (request) => {
    const useCase = new UpdateTenantModulesUseCase(app.db);
    await useCase.execute(request.params.id, request.body, request.auth!.userId);
    await invalidateDashboardCache(app.redis);
    return { success: true };
  });
};
