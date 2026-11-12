import { Kysely, sql } from 'kysely';

/**
 * Migración 091 — Integridad de las suscripciones.
 *
 * Tres defectos que la tabla permitía y que el código daba por imposibles:
 *
 * 1. **Dos ortografías del mismo estado.** `SubscriptionService.cancelSubscription`
 *    escribía `'CANCELED'` mientras el tipo `SubscriptionStatus` y las métricas de
 *    facturación consultan `'CANCELLED'`. Las bajas no aparecían en el churn: no es que el
 *    número estuviera mal, es que la fila no la veía nadie.
 *
 * 2. **Varias suscripciones vivas por comercio.** No había unicidad, y todas las lecturas
 *    hacen `executeTakeFirst()` sin `ORDER BY`. Con dos filas, cuál se lee es arbitrario y
 *    puede cambiar entre peticiones — incluido el `plan_id` que se firma dentro del JWT en
 *    cada login. El índice es parcial a propósito: un comercio que se da de baja y vuelve
 *    debe poder tener su histórico de canceladas junto a la nueva.
 *
 * 3. **Cualquier cadena valía como estado.** Sin `CHECK`, un error de escritura como el
 *    del punto 1 no se detecta hasta que alguien echa en falta el dato, meses después.
 *
 * La migración falla a propósito si encuentra un comercio con dos suscripciones vivas: eso
 * es un problema de datos que hay que mirar, no algo que un índice deba resolver callando.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  // 1. Unificar la ortografía antes de restringirla.
  await sql`
    UPDATE tenant_subscriptions
    SET status = 'CANCELLED', updated_at = now()
    WHERE status = 'CANCELED'
  `.execute(db);

  await sql`
    UPDATE subscription_events
    SET type = 'CANCELLED'
    WHERE type = 'CANCELED'
  `.execute(db);

  // 2. Una sola suscripción viva por comercio. Las canceladas quedan fuera del índice
  //    para no impedir que un comercio que vuelve tenga su histórico.
  await sql`
    CREATE UNIQUE INDEX uq_tenant_subscriptions_live
    ON tenant_subscriptions (tenant_id)
    WHERE status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED')
  `.execute(db);

  // 3. Cerrar el conjunto de estados admitidos.
  await sql`
    ALTER TABLE tenant_subscriptions
    ADD CONSTRAINT tenant_subscriptions_status_check
    CHECK (status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'))
  `.execute(db);

  // 4. Índice para la búsqueda por comercio ordenada, que es como la hace ahora el código.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant_created
    ON tenant_subscriptions (tenant_id, created_at DESC)
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_tenant_subscriptions_tenant_created`.execute(db);
  await sql`ALTER TABLE tenant_subscriptions DROP CONSTRAINT IF EXISTS tenant_subscriptions_status_check`.execute(db);
  await sql`DROP INDEX IF EXISTS uq_tenant_subscriptions_live`.execute(db);
  // La ortografía no se revierte: volver a `'CANCELED'` reintroduciría el defecto.
}
