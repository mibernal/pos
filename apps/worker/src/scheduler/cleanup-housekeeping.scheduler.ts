import type { Pool } from 'pg';
import { logWorkerInfo, logWorkerError } from '../infra/logging/worker-log.js';

export async function cleanupExpiredTokens(pool: Pool) {
  try {
    const result = await pool.query(`
      DELETE FROM refresh_tokens
      WHERE expires_at < NOW() - INTERVAL '1 day'
    `);
      
    logWorkerInfo({ 
      event: 'housekeeping_refresh_tokens',
      message: 'Housekeeping: Limpieza de refresh tokens expirados completada',
      details: { deletedTokens: result.rowCount } 
    });
  } catch (err) {
    logWorkerError({
      event: 'housekeeping_refresh_tokens_failed',
      message: 'Error en housekeeping de refresh tokens',
      error: err
    });
  }
}

export async function cleanupProcessedOutboxEvents(pool: Pool) {
  try {
    const result = await pool.query(`
      DELETE FROM outbox_events
      WHERE status = 'SENT'
      AND created_at < NOW() - INTERVAL '30 days'
    `);

    logWorkerInfo({ 
      event: 'housekeeping_outbox_events',
      message: 'Housekeeping: Limpieza de outbox events antiguos completada',
      details: { deletedOutboxEvents: result.rowCount } 
    });
  } catch (err) {
    logWorkerError({
      event: 'housekeeping_outbox_events_failed',
      message: 'Error en housekeeping de outbox events',
      error: err
    });
  }
}

export async function runHousekeepingJobs(pool: Pool) {
  await cleanupExpiredTokens(pool);
  await cleanupProcessedOutboxEvents(pool);
}
