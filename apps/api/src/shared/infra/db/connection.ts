import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { env } from '../../../app/env.js';
import type { Database } from './schema.js';

export function createDb(): Kysely<Database> {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX
  });

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool })
  });
}
