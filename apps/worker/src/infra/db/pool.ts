import { Pool } from 'pg';
import { env } from '../../config/env.js';

export function createDbPool(): Pool {
  return new Pool({
    // Ver la nota en config/env.ts: el worker necesita lectura transversal.
    connectionString: env.ADMIN_DATABASE_URL ?? env.DATABASE_URL,
    max: 10
  });
}
