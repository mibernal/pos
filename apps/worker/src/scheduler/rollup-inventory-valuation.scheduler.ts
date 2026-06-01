import type { Pool } from 'pg';

export async function rollupInventoryValuation(pool: Pool): Promise<void> {
  const query = `
    WITH tenant_valuation AS (
      SELECT 
        b.tenant_id, 
        CURRENT_DATE as date,
        COALESCE(SUM(b.on_hand_qty * p.cost_cents), 0) as total_value_cents
      FROM inventory_balances b
      INNER JOIN products p ON p.id = b.product_id
      GROUP BY b.tenant_id
    )
    INSERT INTO inventory_valuation_snapshot (tenant_id, date, total_value_cents, updated_at)
    SELECT tenant_id, date, total_value_cents, NOW()
    FROM tenant_valuation
    ON CONFLICT (tenant_id, date) DO UPDATE
    SET 
      total_value_cents = EXCLUDED.total_value_cents,
      updated_at = NOW()
  `;

  await pool.query(query);
}
