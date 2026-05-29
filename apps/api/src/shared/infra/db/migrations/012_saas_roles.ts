import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add new roles 'MANAGER' and 'AUDITOR' to user_role_enum
  await sql`ALTER TYPE user_role_enum ADD VALUE 'MANAGER'`.execute(db);
  await sql`ALTER TYPE user_role_enum ADD VALUE 'AUDITOR'`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // PostgreSQL does not support removing values from an ENUM type easily.
  // We would need to recreate the type. For simplicity in a down migration,
  // we do nothing or we could throw an error.
}
