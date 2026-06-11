import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { GetPlansUseCase } from '../../application/billing-plans/get-plans.use-case.js';
import { CreatePlanUseCase } from '../../application/billing-plans/create-plan.use-case.js';
import { UpdatePlanUseCase } from '../../application/billing-plans/update-plan.use-case.js';
import { DeletePlanUseCase } from '../../application/billing-plans/delete-plan.use-case.js';

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
    return { success: true };
  });
};
