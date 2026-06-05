import type { Pool } from 'pg';

export async function checkAbnormalRefunds(pool: Pool): Promise<number> {
  const threshold = 5; // Trigger alert if >= 5 voided/returned sales in 24h

  const query = `
    WITH recent_refunds AS (
      SELECT tenant_id, branch_id, COUNT(id) as refund_count
      FROM sales
      WHERE status IN ('VOID', 'RETURNED')
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY tenant_id, branch_id
      HAVING COUNT(id) >= $1
    )
    SELECT r.tenant_id, r.branch_id, r.refund_count
    FROM recent_refunds r
    WHERE NOT EXISTS (
      SELECT 1 FROM tenant_alerts ta
      WHERE ta.tenant_id = r.tenant_id
        AND ta.branch_id = r.branch_id
        AND ta.type = 'ABNORMAL_REFUNDS'
        AND ta.created_at >= NOW() - INTERVAL '24 hours'
    )
  `;

  const { rows } = await pool.query(query, [threshold]);
  let alertedCount = 0;

  for (const row of rows) {
    await pool.query(
      `
        INSERT INTO tenant_alerts (
          tenant_id,
          branch_id,
          type,
          severity,
          title,
          message,
          metadata,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'UNREAD')
      `,
      [
        row.tenant_id,
        row.branch_id,
        'ABNORMAL_REFUNDS',
        'WARNING',
        'Devoluciones Anormales Detectadas',
        `Se han detectado ${row.refund_count} anulaciones/devoluciones en las últimas 24 horas.`,
        JSON.stringify({ refund_count: row.refund_count, timeframe_hours: 24 })
      ]
    );
    alertedCount++;
  }

  return alertedCount;
}
