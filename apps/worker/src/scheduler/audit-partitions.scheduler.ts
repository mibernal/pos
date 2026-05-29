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

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${partitionName} 
        PARTITION OF audit_logs 
        FOR VALUES FROM ('${startDate}') TO ('${endDate}')
      `);
      
      logWorkerInfo({
        event: 'audit_partition_ensured',
        message: `Ensured partition ${partitionName} exists`,
        details: { partitionName, startDate, endDate }
      });
    } catch (error: any) {
      // Ignore error if partition already exists (Postgres might throw instead of IF NOT EXISTS working perfectly for partitions in some older versions, though modern PG supports it)
      if (error.code !== '42P07') { // 42P07 = duplicate_table
        logWorkerError({
          event: 'audit_partition_creation_failed',
          message: `Failed to create partition ${partitionName}`,
          error
        });
      }
    }
  }
}
