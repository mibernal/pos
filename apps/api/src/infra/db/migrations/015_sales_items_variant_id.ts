import { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('sale_items')
    .addColumn('variant_id', 'uuid', (col) => col.references('product_variants.id').onDelete('set null'))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('sale_items')
    .dropColumn('variant_id')
    .execute();
}
