import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE sales
    ADD COLUMN void_reason TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE sales
    ADD COLUMN voided_by_user_id UUID NULL
  `.execute(db);

  await sql`
    ALTER TABLE sales
    ADD COLUMN voided_at TIMESTAMPTZ NULL
  `.execute(db);

  await sql`
    ALTER TABLE sales
    ADD CONSTRAINT fk_sales_voided_by_user
    FOREIGN KEY (voided_by_user_id) REFERENCES users (id) ON DELETE RESTRICT
  `.execute(db);

  await sql`
    ALTER TABLE sales
    ADD CONSTRAINT ck_sales_void_reason_not_blank
    CHECK (void_reason IS NULL OR char_length(trim(void_reason)) > 0)
  `.execute(db);

  await sql`
    UPDATE sales
    SET
      void_reason = COALESCE(void_reason, 'Venta anulada antes de capturar motivo'),
      voided_by_user_id = COALESCE(voided_by_user_id, created_by_user_id),
      voided_at = COALESCE(voided_at, created_at)
    WHERE status = 'VOID'
  `.execute(db);

  await sql`
    ALTER TABLE sales
    ADD CONSTRAINT ck_sales_void_metadata_consistency
    CHECK (
      (
        status = 'VOID'
        AND void_reason IS NOT NULL
        AND voided_by_user_id IS NOT NULL
        AND voided_at IS NOT NULL
      )
      OR
      (
        status = 'COMPLETED'
        AND void_reason IS NULL
        AND voided_by_user_id IS NULL
        AND voided_at IS NULL
      )
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_sales_tenant_voided_at
    ON sales (tenant_id, voided_at DESC)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS idx_sales_tenant_voided_at
  `.execute(db);

  await sql`
    ALTER TABLE sales
    DROP CONSTRAINT IF EXISTS ck_sales_void_metadata_consistency
  `.execute(db);

  await sql`
    ALTER TABLE sales
    DROP CONSTRAINT IF EXISTS ck_sales_void_reason_not_blank
  `.execute(db);

  await sql`
    ALTER TABLE sales
    DROP CONSTRAINT IF EXISTS fk_sales_voided_by_user
  `.execute(db);

  await sql`
    ALTER TABLE sales
    DROP COLUMN IF EXISTS voided_at
  `.execute(db);

  await sql`
    ALTER TABLE sales
    DROP COLUMN IF EXISTS voided_by_user_id
  `.execute(db);

  await sql`
    ALTER TABLE sales
    DROP COLUMN IF EXISTS void_reason
  `.execute(db);
}
