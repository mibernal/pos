import type { Pool } from 'pg';

export async function rollupDailySales(pool: Pool): Promise<void> {
  const query = `
    WITH today_sales AS (
      SELECT 
        tenant_id, 
        branch_id,
        CURRENT_DATE as date,
        COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN total_cents ELSE 0 END), 0) as total_revenue_cents,
        COALESCE(SUM(CASE WHEN status = 'VOID' THEN total_cents ELSE 0 END), 0) as total_voids_cents,
        COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as sales_count
      FROM sales
      WHERE created_at >= CURRENT_DATE
      GROUP BY tenant_id, branch_id
    )
    INSERT INTO daily_branch_sales_rollup (tenant_id, branch_id, date, total_revenue_cents, total_voids_cents, sales_count, updated_at)
    SELECT tenant_id, branch_id, date, total_revenue_cents, total_voids_cents, sales_count, NOW()
    FROM today_sales
    ON CONFLICT (tenant_id, branch_id, date) DO UPDATE
    SET 
      total_revenue_cents = EXCLUDED.total_revenue_cents,
      total_voids_cents = EXCLUDED.total_voids_cents,
      sales_count = EXCLUDED.sales_count,
      updated_at = NOW()
  `;

  await pool.query(query);
}
