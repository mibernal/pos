import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Make tenant_id nullable on users and refresh_tokens
  await sql`ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL`.execute(db);
  await sql`ALTER TABLE refresh_tokens ALTER COLUMN tenant_id DROP NOT NULL`.execute(db);

  // 2. Platform Settings Table
  await sql`
    CREATE TABLE platform_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(db);

  // 3. Impersonation Sessions Table
  await sql`
    CREATE TABLE impersonation_sessions (
      id UUID PRIMARY KEY,
      platform_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ NULL
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS impersonation_sessions`.execute(db);
  await sql`DROP TABLE IF EXISTS platform_settings`.execute(db);
  
  // NOTE: Making tenant_id NOT NULL again in down migration could fail if there are records with NULL tenant_id.
  // We leave it as is or add a default. We'll skip making it NOT NULL in down for safety.
}
