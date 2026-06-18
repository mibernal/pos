import { sql, Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await sql`
    ALTER TABLE users
    ADD COLUMN pin_hash VARCHAR(255)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await sql`
    ALTER TABLE users
    DROP COLUMN pin_hash
  `.execute(db);
}
