import type { Pool } from 'pg';

export async function checkStalledOutboxEvents(pool: Pool): Promise<number> {
  const stalledHours = 1;

  const query = `
    WITH stalled_events AS (
      SELECT tenant_id, COUNT(id) as stalled_count
      FROM outbox_events
      WHERE status IN ('PENDING', 'FAILED')
        AND created_at <= NOW() - INTERVAL '1 hour'
      GROUP BY tenant_id
      HAVING COUNT(id) > 0
    )
    SELECT s.tenant_id, s.stalled_count
    FROM stalled_events s
    WHERE NOT EXISTS (
      SELECT 1 FROM tenant_alerts ta
      WHERE ta.tenant_id = s.tenant_id
        AND ta.branch_id IS NULL
        AND ta.type = 'SYSTEM_OUTBOX_STALLED'
        AND ta.created_at >= NOW() - INTERVAL '1 hour'
    )
  `;

  const { rows } = await pool.query(query);
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
        ) VALUES ($1, NULL, $2, $3, $4, $5, $6, 'UNREAD')
      `,
      [
        row.tenant_id,
        'SYSTEM_OUTBOX_STALLED',
        'CRITICAL',
        'Eventos Estancados',
        `Hay ${row.stalled_count} eventos (ej. facturación electrónica DIAN) estancados o fallando repetidamente por más de 1 hora.`,
        JSON.stringify({ stalled_count: row.stalled_count, timeframe_hours: stalledHours })
      ]
    );
    alertedCount++;
  }

  return alertedCount;
}
