import type { Pool } from 'pg';
import { logWorkerError, logWorkerInfo } from '../infra/logging/worker-log.js';

/**
 * Creates monthly partitions for the audit_logs table.
 * It ensures that partitions exist for the current month and the next month.
 */
export async function ensureAuditLogPartitions(pool: Pool): Promise<void> {
  const now = new Date();

  // Current month
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  // Next month
  let nextMonth = currentMonth + 1;
  let nextYear = currentYear;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear++;
  }

  // Month after next
  let monthAfterNext = nextMonth + 1;
  let yearAfterNext = nextYear;
  if (monthAfterNext > 12) {
    monthAfterNext = 1;
    yearAfterNext++;
  }

  const partitionsToCreate = [
    { year: currentYear, month: currentMonth, nextYear, nextMonth },
    { year: nextYear, month: nextMonth, nextYear: yearAfterNext, nextMonth: monthAfterNext }
  ];

  for (const { year, month, nextYear, nextMonth: nextM } of partitionsToCreate) {
    const monthStr = month.toString().padStart(2, '0');
    const partitionName = `audit_logs_y${year}m${monthStr}`;

    const startDate = `${year}-${monthStr}-01`;
    const nextMonthStr = nextM.toString().padStart(2, '0');
    const endDate = `${nextYear}-${nextMonthStr}-01`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Check if partition exists
      const { rowCount } = await client.query(`
        SELECT 1 
        FROM pg_class c 
        JOIN pg_namespace n ON n.oid = c.relnamespace 
        WHERE c.relname = $1 AND n.nspname = 'public'
      `, [partitionName]);

      if (!rowCount) {
        // 2. Create standalone table
        await client.query(`CREATE TABLE ${partitionName} (LIKE audit_logs INCLUDING ALL)`);

        // 3. Move existing conflicting rows from default partition
        await client.query(`
          WITH moved_rows AS (
            DELETE FROM audit_logs_default 
            WHERE created_at >= $1::timestamp AND created_at < $2::timestamp
            RETURNING *
          )
          INSERT INTO ${partitionName} SELECT * FROM moved_rows
        `, [startDate, endDate]);

        // 4. Attach partition
        await client.query(`
          ALTER TABLE audit_logs 
          ATTACH PARTITION ${partitionName} 
          FOR VALUES FROM ('${startDate}') TO ('${endDate}')
        `);
      }

      await client.query('COMMIT');

      logWorkerInfo({
        event: 'audit_partition_ensured',
        message: `Ensured partition ${partitionName} exists`,
        details: { partitionName, startDate, endDate }
      });
    } catch (error: any) {
      await client.query('ROLLBACK');
      logWorkerError({
        event: 'audit_partition_creation_failed',
        message: `Failed to create partition ${partitionName}`,
        error
      });
    } finally {
      client.release();
    }
  }
}
