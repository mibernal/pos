import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('tenants')
    .addColumn('enable_guests_count', 'boolean', (col) => col.defaultTo(true).notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('tenants')
    .dropColumn('enable_guests_count')
    .execute();
}
