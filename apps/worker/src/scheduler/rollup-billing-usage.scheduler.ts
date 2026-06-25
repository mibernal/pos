import type { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import type { Database } from '@pos-dian/api/src/shared/infra/db/schema.js';
import { logWorkerInfo, logWorkerError } from '../infra/logging/worker-log.js';

export async function rollupBillingUsage(pool: Pool) {
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool })
  });

  try {
    // 1. Obtener todas las suscripciones activas
    const subscriptions = await db
      .selectFrom('tenant_subscriptions')
      .select(['id', 'tenant_id', 'current_period_start', 'current_period_end'])
      .where('status', '=', 'ACTIVE')
      .execute();

    let processedCount = 0;

    for (const sub of subscriptions) {
      // 2. Calcular métricas
      
      // Ventas en el periodo
      const salesResult = await db
        .selectFrom('sales')
        .select(db.fn.count<number>('id').as('count'))
        .where('tenant_id', '=', sub.tenant_id)
        .where('status', '=', 'COMPLETED')
        .where('created_at', '>=', sub.current_period_start)
        .executeTakeFirst();
      const salesCount = Number(salesResult?.count || 0);

      // Usuarios Activos (Aprovisionados)
      const usersResult = await db
        .selectFrom('user_branches')
        .select(db.fn.count<number>('user_id').distinct().as('count'))
        .where('tenant_id', '=', sub.tenant_id)
        .executeTakeFirst();
      const activeUsersCount = Number(usersResult?.count || 0);

      // Sucursales (todas, sin filtro is_active — columna no existe en branches)
      const branchesResult = await db
        .selectFrom('branches')
        .select(db.fn.count<number>('id').as('count'))
        .where('tenant_id', '=', sub.tenant_id)
        .executeTakeFirst();
      const branchesCount = Number(branchesResult?.count || 0);

      // Almacenamiento
      const storageResult = await db
        .selectFrom('product_images')
        .select(sql<string>`SUM(CAST(size_bytes AS BIGINT))`.as('total_bytes'))
        .where('tenant_id', '=', sub.tenant_id)
        .executeTakeFirst();
      const storageBytes = Number(storageResult?.total_bytes || 0);

      // Trabajos Ejecutados (Outbox events en el periodo)
      const jobsResult = await db
        .selectFrom('outbox_events')
        .select(db.fn.count<number>('id').as('count'))
        .where('tenant_id', '=', sub.tenant_id)
        .where('type', '!=', 'api_metric_tick') // Excluir los ticks de API
        .where('created_at', '>=', sub.current_period_start)
        .executeTakeFirst();
      const jobsCount = Number(jobsResult?.count || 0);

      // Consumo de API (Sumando los payloads de api_metric_tick)
      const apiResult = await db
        .selectFrom('outbox_events')
        .select(sql<number>`SUM(CAST(payload_json->>'count' AS INTEGER))`.as('total_api_calls'))
        .where('tenant_id', '=', sub.tenant_id)
        .where('type', '=', 'api_metric_tick')
        .where('created_at', '>=', sub.current_period_start)
        .executeTakeFirst();
      const apiCallsCount = Number(apiResult?.total_api_calls || 0);

      // 3. Guardar el Snapshot en subscription_events
      await db.insertInto('subscription_events')
        .values({
          subscription_id: sub.id,
          type: 'USAGE_SNAPSHOT',
          metadata: {
            sales_count: salesCount,
            active_users_count: activeUsersCount,
            branches_count: branchesCount,
            storage_bytes: storageBytes,
            jobs_count: jobsCount,
            api_calls_count: apiCallsCount,
            period_start: sub.current_period_start.toISOString(),
            snapshot_date: new Date().toISOString()
          }
        })
        .execute();

      processedCount++;
    }

    logWorkerInfo({
      event: 'billing_usage_rollup_completed',
      message: 'Rollup de métricas de facturación completado',
      details: { processedCount }
    });

  } catch (error) {
    logWorkerError({
      event: 'billing_usage_rollup_failed',
      message: 'Fallo al ejecutar rollup de métricas de facturación',
      error
    });
    throw error;
  }
}
