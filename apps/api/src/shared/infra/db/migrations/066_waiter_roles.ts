import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Alter enum outside transaction using Postgres workaround
  await sql`COMMIT`.execute(db);
  await sql`ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'WAITER'`.execute(db);
  await sql`BEGIN`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // Enums values cannot be easily removed in Postgres, no-op down migration
}
