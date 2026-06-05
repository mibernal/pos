import type { Pool, PoolClient } from 'pg';

/**
 * executeAsTenantClient
 *
 * Análogo al `executeAsTenant()` de la API (apps/api/src/shared/infra/db/rls.ts),
 * pero diseñado para el worker que usa `pg.Pool` raw en lugar de Kysely.
 *
 * PROPÓSITO:
 * Los outbox processors conocen el tenant_id de cada job (viene del evento).
 * Aunque el rol `app_worker` tiene BYPASSRLS (migración 040), configurar
 * app.current_tenant igualmente añade una segunda capa de defensa:
 * si el rol del worker alguna vez perdiera BYPASSRLS, el RLS seguiría
 * siendo correcto para los processors per-tenant.
 *
 * COMPORTAMIENTO:
 * 1. Checkea un PoolClient dedicado del pool (conexión exclusiva para el job).
 * 2. Inicia una transacción.
 * 3. Llama a set_config('app.current_tenant', tenantId, true) — LOCAL a la transacción.
 * 4. Ejecuta el callback con el client ya configurado.
 * 5. Hace COMMIT (o ROLLBACK si el callback lanza).
 * 6. Libera el client de vuelta al pool.
 *
 * NOTA: usar `true` como tercer argumento de set_config garantiza que el valor
 * sea LOCAL a la transacción — expire automáticamente en COMMIT/ROLLBACK,
 * evitando contaminación si el client se reutiliza desde el pool.
 *
 * USO EN PROCESSORS:
 *
 *   const result = await executeAsTenantClient(pool, tenantId, async (client) => {
 *     const { rows } = await client.query(
 *       'SELECT * FROM sales WHERE tenant_id = $1 AND id = $2',
 *       [tenantId, saleId]
 *     );
 *     return rows[0];
 *   });
 */
export async function executeAsTenantClient<T>(
  pool: Pool,
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL: expira automáticamente al finalizar la transacción (COMMIT/ROLLBACK).
    // Usa set_config en lugar de SET LOCAL porque permite pasar el valor como parámetro bind.
    await client.query(
      "SELECT set_config('app.current_tenant', $1, true)",
      [tenantId]
    );
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
