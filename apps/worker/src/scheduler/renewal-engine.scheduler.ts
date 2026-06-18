import type { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Database } from '@pos-dian/api/src/shared/infra/db/schema.js';
import { RenewalEngine } from '@pos-dian/api/src/contexts/billing/application/renewal-engine.js';
import { logWorkerInfo, logWorkerError } from '../infra/logging/worker-log.js';

export async function runSubscriptionRenewals(pool: Pool) {
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool
    })
  });

  try {
    const results = await RenewalEngine.runAll(db);
    
    if (results.trials > 0 || results.renewals > 0 || results.retries > 0 || results.suspensions > 0) {
      logWorkerInfo({
        event: 'subscription_renewal_engine_run',
        message: 'Subscription renewal engine executed',
        details: results
      });
    }
  } catch (error) {
    logWorkerError({
      event: 'subscription_renewal_engine_error',
      message: 'Failed to run subscription renewal engine',
      error
    });
    throw error;
  }
}
