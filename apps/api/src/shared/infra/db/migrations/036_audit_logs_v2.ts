import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Alteramos la tabla de auditoría particionada
  await sql`
    ALTER TABLE audit_logs 
    ADD COLUMN ip_address TEXT,
    ADD COLUMN user_agent TEXT,
    ADD COLUMN correlation_id UUID,
    ADD COLUMN old_values JSONB,
    ADD COLUMN new_values JSONB;
  `.execute(db);

  await sql`
    ALTER TABLE audit_logs 
    RENAME COLUMN payload_json TO legacy_payload;
  `.execute(db);

  // Índices para búsquedas de red / correlación
  await sql`
    CREATE INDEX idx_audit_logs_correlation 
    ON audit_logs (correlation_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS idx_audit_logs_correlation
  `.execute(db);

  await sql`
    ALTER TABLE audit_logs 
    RENAME COLUMN legacy_payload TO payload_json;
  `.execute(db);

  await sql`
    ALTER TABLE audit_logs 
    DROP COLUMN ip_address,
    DROP COLUMN user_agent,
    DROP COLUMN correlation_id,
    DROP COLUMN old_values,
    DROP COLUMN new_values;
  `.execute(db);
}
