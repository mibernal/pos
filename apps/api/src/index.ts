import { env } from './app/env.js';
import { buildApp } from './app/build-app.js';

/**
 * Cuánto se espera a que terminen las peticiones en vuelo antes de cortar por lo sano.
 *
 * 25 s deja margen a un `POST /sales` lento (bloqueo pesimista de inventario + escritura
 * de los libros) y queda por debajo del plazo típico de un orquestador antes del SIGKILL
 * (30 s en Kubernetes y en la mayoría de PaaS).
 */
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000);

async function bootstrap() {
  const app = await buildApp();
  const timers: NodeJS.Timeout[] = [];
  let shuttingDown = false;

  /**
   * Cierre ordenado.
   *
   * Sin esto, cada despliegue cortaba las peticiones en vuelo: un `POST /sales` a medio
   * confirmar deja la venta escrita sin que el cajero reciba respuesta, y el POS reintenta
   * —la idempotencia por `client_uuid` lo salva, pero el cajero ya vio un error—. Además,
   * el `setInterval` de métricas mantenía el proceso vivo indefinidamente.
   *
   * `app.close()` deja de aceptar conexiones nuevas, espera a que terminen las abiertas y
   * dispara el hook `onClose` (cola de BullMQ, Redis y el pool de Postgres).
   */
  const shutdown = async (signal: string) => {
    // Señales duplicadas (SIGINT y SIGTERM casi a la vez) no deben reentrar aquí.
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info({ signal }, 'Cierre ordenado iniciado: no se aceptan peticiones nuevas');

    for (const timer of timers) clearInterval(timer);

    // Si algo se queda colgado, se sale igual: un proceso que no muere es peor que uno que
    // corta, porque el orquestador acaba mandando SIGKILL sin que se cierre nada.
    const forceExit = setTimeout(() => {
      app.log.error(
        { timeout_ms: SHUTDOWN_TIMEOUT_MS },
        'El cierre ordenado excedió su plazo; se termina el proceso de todos modos'
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await app.close();
      app.log.info('Cierre ordenado completado');
      process.exit(0);
    } catch (error) {
      app.log.error(error, 'Fallo durante el cierre ordenado');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Un error no capturado deja el proceso en estado desconocido: se registra y se cierra
  // ordenadamente en vez de seguir sirviendo peticiones desde un estado corrupto.
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'Promesa rechazada sin manejar');
    void shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    app.log.fatal({ err: error }, 'Excepción no capturada');
    void shutdown('uncaughtException');
  });

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
    const outboxMetricsTimer = setInterval(async () => {
      if (shuttingDown) return;
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

    // `unref` para que este temporizador no sea, por sí solo, motivo de que el proceso siga vivo.
    outboxMetricsTimer.unref();
    timers.push(outboxMetricsTimer);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

bootstrap();
