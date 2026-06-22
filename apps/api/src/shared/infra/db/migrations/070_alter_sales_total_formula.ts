import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('sales')
    .dropConstraint('ck_sales_total_formula')
    .execute();

  await db.schema
    .alterTable('sales')
    .addCheckConstraint('ck_sales_total_formula', sql`total_cents = subtotal_cents - discount_cents + tip_cents`)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('sales')
    .dropConstraint('ck_sales_total_formula')
    .execute();

  await db.schema
    .alterTable('sales')
    .addCheckConstraint('ck_sales_total_formula', sql`total_cents = subtotal_cents - discount_cents`)
    .execute();
}
