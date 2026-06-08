import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await db.schema
    .createTable('refresh_tokens')
    .addColumn('id', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('cascade').notNull())
    .addColumn('token_hash', 'varchar', (col) => col.notNull())
    .addColumn('expires_at', 'timestamp', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`NOW()`).notNull())
    .addColumn('revoked_at', 'timestamp')
    .execute();

  await db.schema
    .createIndex('refresh_tokens_user_id_idx')
    .on('refresh_tokens')
    .column('user_id')
    .execute();
    
  await db.schema
    .createIndex('refresh_tokens_token_hash_idx')
    .on('refresh_tokens')
    .column('token_hash')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await db.schema.dropTable('refresh_tokens').execute();
}
