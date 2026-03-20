import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE audit_logs (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      branch_id UUID NULL,
      user_id UUID NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_audit_logs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT fk_audit_logs_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE SET NULL,
      CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT ck_audit_logs_entity_type_not_blank CHECK (char_length(trim(entity_type)) > 0),
      CONSTRAINT ck_audit_logs_entity_id_not_blank CHECK (char_length(trim(entity_id)) > 0),
      CONSTRAINT ck_audit_logs_action_not_blank CHECK (char_length(trim(action)) > 0),
      CONSTRAINT uq_audit_logs_tenant_id_pair UNIQUE (tenant_id, id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_audit_logs_tenant_created
    ON audit_logs (tenant_id, created_at DESC)
  `.execute(db);

  await sql`
    CREATE INDEX idx_audit_logs_tenant_entity
    ON audit_logs (tenant_id, entity_type, entity_id)
  `.execute(db);

  await sql`
    CREATE INDEX idx_audit_logs_tenant_branch
    ON audit_logs (tenant_id, branch_id, created_at DESC)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS idx_audit_logs_tenant_branch
  `.execute(db);

  await sql`
    DROP INDEX IF EXISTS idx_audit_logs_tenant_entity
  `.execute(db);

  await sql`
    DROP INDEX IF EXISTS idx_audit_logs_tenant_created
  `.execute(db);

  await sql`
    DROP TABLE IF EXISTS audit_logs
  `.execute(db);
}
