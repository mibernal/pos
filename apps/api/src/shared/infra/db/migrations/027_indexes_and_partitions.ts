import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Nuevos Índices Compuestos
  await sql`
    CREATE INDEX IF NOT EXISTS idx_sales_tenant_branch_created 
    ON sales (tenant_id, branch_id, created_at DESC)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_sales_tenant_status 
    ON sales (tenant_id, status)
  `.execute(db);

  // 2. Refactorizar audit_logs para particionamiento
  // Renombrar tabla vieja
  await sql`ALTER TABLE audit_logs RENAME TO audit_logs_old;`.execute(db);

  // Renombrar el índice de la restricción UNIQUE heredada de la migración 004.
  // `ALTER TABLE ... RENAME` NO renombra los índices asociados, y los nombres de
  // índice son únicos por esquema: sin esto, el CREATE TABLE de abajo falla con
  // «relation "uq_audit_logs_tenant_id_pair" already exists» y toda la migración
  // hace rollback — impidiendo construir el esquema desde cero.
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_audit_logs_tenant_id_pair'
          AND conrelid = 'audit_logs_old'::regclass
      ) THEN
        ALTER TABLE audit_logs_old
          RENAME CONSTRAINT uq_audit_logs_tenant_id_pair TO uq_audit_logs_old_tenant_id_pair;
      END IF;
    END
    $$;
  `.execute(db);

  // Crear tabla nueva con PARTITION BY RANGE
  await sql`
    CREATE TABLE audit_logs (
      id UUID,
      tenant_id UUID NOT NULL,
      branch_id UUID NULL,
      user_id UUID NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT pk_audit_logs PRIMARY KEY (id, created_at),
      CONSTRAINT fk_audit_logs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
      CONSTRAINT fk_audit_logs_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE SET NULL,
      CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT ck_audit_logs_entity_type_not_blank CHECK (char_length(trim(entity_type)) > 0),
      CONSTRAINT ck_audit_logs_entity_id_not_blank CHECK (char_length(trim(entity_id)) > 0),
      CONSTRAINT ck_audit_logs_action_not_blank CHECK (char_length(trim(action)) > 0),
      CONSTRAINT uq_audit_logs_tenant_id_pair UNIQUE (tenant_id, id, created_at)
    ) PARTITION BY RANGE (created_at);
  `.execute(db);

  // Crear partición default para albergar datos existentes y datos futuros que no tengan partición específica
  await sql`CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;`.execute(db);

  // Mover datos
  await sql`INSERT INTO audit_logs SELECT * FROM audit_logs_old;`.execute(db);

  // Eliminar tabla vieja y sus restricciones (y sus índices con nombres colisionantes)
  await sql`DROP TABLE audit_logs_old CASCADE;`.execute(db);

  // Re-crear índices
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON audit_logs (tenant_id, created_at DESC)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_entity ON audit_logs (tenant_id, entity_type, entity_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_branch ON audit_logs (tenant_id, branch_id, created_at DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_sales_tenant_branch_created`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_sales_tenant_status`.execute(db);

  // Volver atrás particionamiento (Cuidado: esto asume que los datos caben en la tabla vieja)
  await sql`ALTER TABLE audit_logs RENAME TO audit_logs_partitioned;`.execute(db);

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

  await sql`INSERT INTO audit_logs SELECT * FROM audit_logs_partitioned ON CONFLICT (id) DO NOTHING;`.execute(db);

  await sql`CREATE INDEX idx_audit_logs_tenant_created ON audit_logs (tenant_id, created_at DESC)`.execute(db);
  await sql`CREATE INDEX idx_audit_logs_tenant_entity ON audit_logs (tenant_id, entity_type, entity_id)`.execute(db);
  await sql`CREATE INDEX idx_audit_logs_tenant_branch ON audit_logs (tenant_id, branch_id, created_at DESC)`.execute(db);

  await sql`DROP TABLE audit_logs_partitioned CASCADE;`.execute(db);
}
