import { Kysely, sql, type SqlBool } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createIndex('idx_tables_active_orders')
    .on('table_orders')
    .column('tenant_id')
    .where(sql<SqlBool>`status = 'OPEN'`)
    .execute();

  await db.schema
    .createIndex('idx_kitchen_pending')
    .on('kitchen_tickets')
    .column('tenant_id')
    .where(sql<SqlBool>`status IN ('PENDING', 'PREPARING')`)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_tables_active_orders').execute();
  await db.schema.dropIndex('idx_kitchen_pending').execute();
}
