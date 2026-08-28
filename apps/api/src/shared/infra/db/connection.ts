import { Kysely, PostgresDialect, KyselyPlugin, PluginTransformQueryArgs, PluginTransformResultArgs, QueryResult, UnknownRow } from 'kysely';
import { Pool } from 'pg';
import { env } from '../../../app/env.js';
import type { Database } from './schema.js';
import { dbLatencyHistogram } from '../../../tracing.js';

class DbMetricsPlugin implements KyselyPlugin {
  #queryStartTimes = new WeakMap<any, [number, number]>(); // eslint-disable-line @typescript-eslint/no-explicit-any

  transformQuery(args: PluginTransformQueryArgs): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.#queryStartTimes.set(args.queryId as any, process.hrtime()); // eslint-disable-line @typescript-eslint/no-explicit-any
    return args.node;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const startTime = this.#queryStartTimes.get(args.queryId as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (startTime) {
      const diff = process.hrtime(startTime);
      const latencyMs = (diff[0] * 1e9 + diff[1]) / 1e6;
      dbLatencyHistogram.record(latencyMs);
    }
    return args.result;
  }
}

export function createDb(): Kysely<Database> {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX
  });

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new DbMetricsPlugin()]
  });
}

/**
 * Conexión con el rol dueño del esquema, para migraciones y semillas.
 *
 * La API corre con un rol SIN BYPASSRLS a propósito: así el aislamiento entre comercios lo
 * impone PostgreSQL. Ese rol no puede hacer DDL ni sembrar filas de varios comercios, que
 * es justo lo que migrar y sembrar necesitan.
 */
export function createAdminDb(): Kysely<Database> {
  const pool = new Pool({
    connectionString: env.ADMIN_DATABASE_URL ?? env.DATABASE_URL,
    max: 4
  });

  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
