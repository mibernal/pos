import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS image_url TEXT NULL
  `.execute(db);

  await sql`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS description TEXT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE products
    DROP COLUMN IF EXISTS description
  `.execute(db);

  await sql`
    ALTER TABLE products
    DROP COLUMN IF EXISTS image_url
  `.execute(db);
}
