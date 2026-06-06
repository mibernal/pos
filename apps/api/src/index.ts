import { env } from './app/env.js';
import { buildApp } from './app/build-app.js';

async function bootstrap() {
  const app = await buildApp();

  try {
    await app.listen({
      port: env.PORT,
      host: process.env.HOST || '127.0.0.1'
    });

    app.log.info(`API running on http://localhost:${env.PORT}`);
    app.log.info(`Swagger UI on http://localhost:${env.PORT}/docs`);

    // Observability: Poll outbox_events table for pending events metrics
    const { outboxPendingGauge } = await import('./tracing.js');
    let lastPendingCount = 0;
    
    // Setup gauge callback to return the latest known count
    outboxPendingGauge.addCallback((result) => {
      result.observe(lastPendingCount);
    });

    // Update the known count every 10 seconds
    setInterval(async () => {
      try {
        const row = await app.db
          .selectFrom('outbox_events')
          .select(app.db.fn.count<string>('id').as('count'))
          .where('status', '=', 'PENDING')
          .executeTakeFirst();
        lastPendingCount = parseInt(row?.count || '0', 10);
      } catch (err) {
        app.log.error(err, 'Error polling outbox_events for metrics');
      }
    }, 10000);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

bootstrap();