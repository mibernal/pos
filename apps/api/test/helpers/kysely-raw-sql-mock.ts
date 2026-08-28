import { vi } from 'vitest';

/**
 * Doble mínimo para que `sql`...`.execute(db)` funcione sobre un mock.
 *
 * Kysely resuelve el SQL crudo pidiendo `db.getExecutor()` y llamando
 * `transformQuery` → `compileQuery` → `executeQuery`. Un mock que solo expone
 * `executeQuery` hace que la llamada lance `getExecutor is not a function`, lo que
 * en las pruebas de salud se traducía en «PostgreSQL DOWN» sin que nada estuviera mal.
 */
export function createRawSqlExecutorMock(rows: unknown[] = []) {
  const executeQuery = vi.fn().mockResolvedValue({ rows });

  const executor = {
    transformQuery: <T>(node: T) => node,
    compileQuery: () => ({ sql: '', parameters: [], query: {} }),
    executeQuery,
    provideConnection: async <T>(consumer: (conn: { executeQuery: typeof executeQuery }) => Promise<T>) =>
      consumer({ executeQuery }),
    createQueryId: () => ({ queryId: 'mock' })
  };

  return { executor, executeQuery, getExecutor: () => executor };
}
