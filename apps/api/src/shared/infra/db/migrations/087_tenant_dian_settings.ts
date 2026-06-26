import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('tenant_dian_settings')
    .addColumn('tenant_id', 'uuid', (col) =>
      col.primaryKey().references('tenants.id').onDelete('cascade')
    )
    .addColumn('provider_name', 'varchar(50)', (col) => col.notNull())
    .addColumn('credentials', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    .addColumn('test_mode', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('resolution_number', 'varchar(100)')
    .addColumn('prefix', 'varchar(20)')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`now()`).notNull()
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.defaultTo(sql`now()`).notNull()
    )
    .execute();

  // Trigger para updated_at
  await sql`
    CREATE TRIGGER update_tenant_dian_settings_modtime
    BEFORE UPDATE ON tenant_dian_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
  `.execute(db);
  
  // Enable RLS for the new table
  await sql`ALTER TABLE tenant_dian_settings ENABLE ROW LEVEL SECURITY;`.execute(db);
  
  await sql`
    CREATE POLICY tenant_isolation_dian_settings ON tenant_dian_settings
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('tenant_dian_settings').execute();
}
