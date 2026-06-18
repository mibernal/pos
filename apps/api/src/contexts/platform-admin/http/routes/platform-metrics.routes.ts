import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CachedPlatformAdminRepository } from '../../infra/cached-platform-admin.repository.js';
import { GetDashboardMetricsUseCase } from '../../application/metrics/get-dashboard-metrics.use-case.js';
import { GetRecentActivityUseCase } from '../../application/metrics/get-recent-activity.use-case.js';
import { GetGrowthMetricsUseCase } from '../../application/metrics/get-growth-metrics.use-case.js';
import { GetPlatformHealthUseCase } from '../../application/metrics/get-platform-health.use-case.js';

export const platformMetricsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const repo = new CachedPlatformAdminRepository(app.db, app.redis);

  typedApp.get('/platform/dashboard', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Get SaaS Executive Dashboard Metrics'
    }
  }, async () => {
    const useCase = new GetDashboardMetricsUseCase(repo);
    const metrics = await useCase.execute();
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
    const useCase = new GetRecentActivityUseCase(repo);
    const activity = await useCase.execute(request.query.limit);
    return { activity };
  });

  typedApp.get('/platform/growth', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Growth charts data'
    }
  }, async () => {
    const useCase = new GetGrowthMetricsUseCase(repo);
    const history = await useCase.execute();
    return { history };
  });

  typedApp.get('/platform/health', {
    schema: {
      tags: ['Platform Admin'],
      summary: 'Aggregated platform health status'
    }
  }, async () => {
    // Cast `app` to any to access the dynamically decorated bulkImportQueue
    const queue = (app as any).bulkImportQueue;
    const useCase = new GetPlatformHealthUseCase(app.db, app.redis, queue);
    return useCase.execute();
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
    
    const sendInitial = async () => {
      const useCase = new GetDashboardMetricsUseCase(repo);
      const expiringSoon = await useCase.execute();
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
};
