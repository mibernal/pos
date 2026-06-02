import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Database } from './schema.js';

/**
 * Wrapper to enforce Row Level Security (RLS) tenant isolation.
 * Executes the given callback inside a transaction where the connection
 * is bound to the provided tenantId using `SET LOCAL app.current_tenant`.
 * 
 * The SET LOCAL guarantees the setting expires automatically at the end 
 * of the transaction (COMMIT/ROLLBACK), preventing leakage across connection pool reuse.
 */
export async function executeAsTenant<T>(
  db: Kysely<Database>,
  tenantId: string,
  callback: (trx: Transaction<Database>) => Promise<T>
): Promise<T> {
  return await db.transaction().execute(async (trx) => {
    // Kysely usa variables bind ($1), lo cual no es válido para `SET LOCAL x = $1` en Postgres.
    // Usamos set_config que sí permite paso de parámetros
    await sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`.execute(trx);
    
    // Ejecutar el callback que interactúa con las tablas RLS-protegidas
    return await callback(trx);
  });
}
