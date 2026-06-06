import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Add new roles to user_role_enum
  // Postgres requires ALTER TYPE ADD VALUE to run outside of a transaction block
  // Kysely migrations run in a transaction by default if they are inside a transaction block, 
  // but we can execute raw sql. To do it safely, we commit the current transaction if any,
  // execute, and then begin again. Actually, in Kysely the migration runner wraps `up` in a transaction.
  // Workaround for Postgres:
  await sql`COMMIT`.execute(db);
  await sql`ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'PLATFORM_OWNER'`.execute(db);
  await sql`ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'TENANT_OWNER'`.execute(db);
  await sql`BEGIN`.execute(db);

  // 2. Add columns to tenants table
  await sql`ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'`.execute(db);
  await sql`ALTER TABLE tenants ADD COLUMN plan TEXT NOT NULL DEFAULT 'STARTER'`.execute(db);
  await sql`ALTER TABLE tenants ADD COLUMN suspended_at TIMESTAMPTZ NULL`.execute(db);
  await sql`ALTER TABLE tenants ADD COLUMN suspended_reason TEXT NULL`.execute(db);
  await sql`ALTER TABLE tenants ADD COLUMN owner_user_id UUID NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE tenants DROP COLUMN IF EXISTS owner_user_id`.execute(db);
  await sql`ALTER TABLE tenants DROP COLUMN IF EXISTS suspended_reason`.execute(db);
  await sql`ALTER TABLE tenants DROP COLUMN IF EXISTS suspended_at`.execute(db);
  await sql`ALTER TABLE tenants DROP COLUMN IF EXISTS plan`.execute(db);
  await sql`ALTER TABLE tenants DROP COLUMN IF EXISTS status`.execute(db);
  // We don't remove ENUM values in down migration
}
