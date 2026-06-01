import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Modificar inventory_balances
  await sql`
    ALTER TABLE inventory_balances
    RENAME COLUMN qty TO on_hand_qty
  `.execute(db);

  await sql`
    ALTER TABLE inventory_balances
    ADD COLUMN reserved_qty numeric(15,3) NOT NULL DEFAULT 0,
    ADD COLUMN in_transit_qty numeric(15,3) NOT NULL DEFAULT 0
  `.execute(db);

  // Asegurar que on_hand_qty también sea un número preciso si era texto o integer (opcional, pero buena práctica en retail)
  // asumiendo que ya era de tipo compatible (varchar u otro numérico), lo convertiremos a numeric
  await sql`
    ALTER TABLE inventory_balances
    ALTER COLUMN on_hand_qty TYPE numeric(15,3) USING on_hand_qty::numeric
  `.execute(db);

  // 2. Modificar inventory_transactions para que funcione como Ledger
  // Añadir balance_after
  await sql`
    ALTER TABLE inventory_transactions
    ADD COLUMN balance_after numeric(15,3) NULL
  `.execute(db);

  // Asegurar precisión en qty_change
  await sql`
    ALTER TABLE inventory_transactions
    ALTER COLUMN qty_change TYPE numeric(15,3) USING qty_change::numeric
  `.execute(db);

  // Llenar balance_after histórico con el saldo actual para evitar NULLs en queries futuros, 
  // Ojo: Esto es una aproximación para transacciones viejas, ya que no podemos reconstruir el historial perfectamente en SQL simple.
  await sql`
    UPDATE inventory_transactions t
    SET balance_after = b.on_hand_qty
    FROM inventory_balances b
    WHERE t.tenant_id = b.tenant_id 
      AND t.branch_id = b.branch_id 
      AND t.product_id = b.product_id
      AND t.variant_id IS NOT DISTINCT FROM b.variant_id
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Rollback inventory_transactions
  await sql`
    ALTER TABLE inventory_transactions
    ALTER COLUMN qty_change TYPE text USING qty_change::text
  `.execute(db);

  await sql`
    ALTER TABLE inventory_transactions
    DROP COLUMN IF EXISTS balance_after
  `.execute(db);

  // Rollback inventory_balances
  await sql`
    ALTER TABLE inventory_balances
    ALTER COLUMN on_hand_qty TYPE text USING on_hand_qty::text
  `.execute(db);

  await sql`
    ALTER TABLE inventory_balances
    DROP COLUMN IF EXISTS reserved_qty,
    DROP COLUMN IF EXISTS in_transit_qty
  `.execute(db);

  await sql`
    ALTER TABLE inventory_balances
    RENAME COLUMN on_hand_qty TO qty
  `.execute(db);
}
