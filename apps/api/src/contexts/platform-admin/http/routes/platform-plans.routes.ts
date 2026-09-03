import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { GetPlansUseCase } from '../../application/billing-plans/get-plans.use-case.js';
import { CreatePlanUseCase } from '../../application/billing-plans/create-plan.use-case.js';
import { UpdatePlanUseCase } from '../../application/billing-plans/update-plan.use-case.js';
import { DeletePlanUseCase } from '../../application/billing-plans/delete-plan.use-case.js';
import { invalidateDashboardCache } from '../../../../shared/infra/cache/invalidate-dashboard-cache.js';
import { PlanEntitlementsUseCase } from '../../application/billing-plans/plan-entitlements.use-case.js';
import { assignableModuleSchema, entitlementKeySchema, limitValueSchema } from '@pos-dian/shared';

/**
 * Lo que un plan da: límites por dimensión y módulos incluidos.
 *
 * `features_json` se conserva por compatibilidad —hay pantallas que aún lo leen— pero ya no
 * es donde se decide nada. Los límites reales viven en `plan_entitlements` y los módulos en
 * `plan_modules`, que es lo que consulta el resolutor.
 */
const planEntitlementsBodySchema = z.object({
  limits: z.record(entitlementKeySchema, limitValueSchema).optional(),
  modules: z.array(assignableModuleSchema).optional()
});

const planFeaturesSchema = z.object({
  users: z.number(),
  branches: z.number(),
  support_level: z.enum(['STANDARD', 'PRIORITY', 'DEDICATED']).optional(),
  allow_offline: z.boolean().optional(),
  custom_domain: z.boolean().optional()
});

const createPlanBodySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  price_cents: z.number().min(0),
  billing_cycle: z.enum(['MONTHLY', 'YEARLY']),
  features_json: planFeaturesSchema
});

const updatePlanBodySchema = z.object({
  name: z.string().min(1).optional(),
  price_cents: z.number().min(0).optional(),
  billing_cycle: z.enum(['MONTHLY', 'YEARLY']).optional(),
  features_json: planFeaturesSchema.optional(),
  active: z.boolean().optional(),
  metadata_json: z.record(z.string(), z.unknown()).nullable().optional()
});

export const platformPlansRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get('/platform/plans', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Get available billing plans'
    }
  }, async () => {
    const useCase = new GetPlansUseCase(app.db);
    const plans = await useCase.execute();
    return { plans };
  });

  typedApp.post('/platform/plans', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Create a new billing plan',
      body: createPlanBodySchema
    }
  }, async (request) => {
    const useCase = new CreatePlanUseCase(app.db);
    const id = await useCase.execute(request.body as any, request.auth!.userId, request.auth!.email);
    await invalidateDashboardCache(app.redis);
    return { success: true, id };
  });

  typedApp.patch('/platform/plans/:id', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Update a billing plan',
      params: z.object({ id: z.string() }),
      body: updatePlanBodySchema
    }
  }, async (request) => {
    const useCase = new UpdatePlanUseCase(app.db);
    await useCase.execute(request.params.id, request.body as any, request.auth!.userId, request.auth!.email);
    await invalidateDashboardCache(app.redis);
    return { success: true };
  });

  typedApp.get('/platform/plans/:id/entitlements', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Límites y módulos que da un plan',
      params: z.object({ id: z.string() })
    }
  }, async (request) => {
    const useCase = new PlanEntitlementsUseCase(app.db, app.entitlements);
    return await useCase.read(request.params.id);
  });

  typedApp.put('/platform/plans/:id/entitlements', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Definir los límites y módulos de un plan',
      params: z.object({ id: z.string() }),
      body: planEntitlementsBodySchema
    }
  }, async (request) => {
    const useCase = new PlanEntitlementsUseCase(app.db, app.entitlements);
    await useCase.write(request.params.id, request.body, request.auth!.userId, request.auth!.email);
    await invalidateDashboardCache(app.redis);
    return { success: true };
  });

  typedApp.delete('/platform/plans/:id', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Soft-delete (archive) a billing plan',
      params: z.object({ id: z.string() })
    }
  }, async (request) => {
    const useCase = new DeletePlanUseCase(app.db);
    await useCase.execute(request.params.id, request.auth!.userId, request.auth!.email);
    await invalidateDashboardCache(app.redis);
    return { success: true };
  });
};
