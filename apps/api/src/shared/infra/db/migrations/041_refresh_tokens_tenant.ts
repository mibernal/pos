import { sql, Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Add tenant_id to refresh_tokens
  await sql`ALTER TABLE refresh_tokens ADD COLUMN tenant_id UUID`.execute(db);

  // Populate tenant_id from users table for existing records
  await sql`
    UPDATE refresh_tokens rt
    SET tenant_id = u.tenant_id
    FROM users u
    WHERE rt.user_id = u.id
  `.execute(db);

  // Make it NOT NULL
  await sql`ALTER TABLE refresh_tokens ALTER COLUMN tenant_id SET NOT NULL`.execute(db);

  // Add foreign key to tenants
  await sql`
    ALTER TABLE refresh_tokens
    ADD CONSTRAINT refresh_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  `.execute(db);

  // Add RLS
  await sql`ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`
    CREATE POLICY tenant_isolation_policy ON refresh_tokens
    FOR ALL USING (tenant_id::text = current_setting('app.current_tenant', true))
  `.execute(db);

  // Add index
  await sql`CREATE INDEX refresh_tokens_tenant_id_idx ON refresh_tokens(tenant_id)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await sql`DROP INDEX IF EXISTS refresh_tokens_tenant_id_idx`.execute(db);
  await sql`DROP POLICY IF EXISTS tenant_isolation_policy ON refresh_tokens`.execute(db);
  await sql`ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_tenant_id_fkey`.execute(db);
  await sql`ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS tenant_id`.execute(db);
}
