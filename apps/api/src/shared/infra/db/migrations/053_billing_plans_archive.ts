import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await db.schema
    .alterTable('billing_plans')
    .addColumn('archived_at', 'timestamp')
    .addColumn('metadata_json', 'jsonb')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await db.schema
    .alterTable('billing_plans')
    .dropColumn('archived_at')
    .dropColumn('metadata_json')
    .execute();
}
