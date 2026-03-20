import { env } from './app/env.js';
import { buildApp } from './app/build-app.js';

async function bootstrap() {
  const app = await buildApp();

  try {
    await app.listen({
      port: env.PORT,
      host: '0.0.0.0'
    });

    app.log.info(`API running on http://localhost:${env.PORT}`);
    app.log.info(`Swagger UI on http://localhost:${env.PORT}/docs`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

bootstrap();