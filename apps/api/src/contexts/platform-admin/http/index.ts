import { FastifyPluginAsync } from 'fastify';
import { platformMetricsRoutes } from './routes/platform-metrics.routes.js';
import { platformTenantsRoutes } from './routes/platform-tenants.routes.js';
import { platformPlansRoutes } from './routes/platform-plans.routes.js';
import { platformUsersRoutes } from './routes/platform-users.routes.js';
import { platformBillingRoutes } from './routes/platform-billing.routes.js';

export const platformAdminRoutes: FastifyPluginAsync = async (app) => {
  // Apply Platform Owner protection to all routes in this context
  app.addHook('onRequest', app.requirePlatformOwner);

  await app.register(platformMetricsRoutes);
  await app.register(platformTenantsRoutes);
  await app.register(platformPlansRoutes);
  await app.register(platformUsersRoutes);
  await app.register(platformBillingRoutes);
};
