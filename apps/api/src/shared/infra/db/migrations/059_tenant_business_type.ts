import { Kysely } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  // 1. Agregar columna con DEFAULT para que tenants existentes queden en 'OTHER'
  await db.schema
    .alterTable('tenants')
    .addColumn('business_type', 'varchar(30)', (col) =>
      col.notNull().defaultTo('OTHER')
    )
    .execute();

  // 2. Agregar columna para texto libre cuando el tipo es 'OTHER'
  await db.schema
    .alterTable('tenants')
    .addColumn('custom_business_type', 'varchar(80)')
    .execute();

  // 3. Agregar columna para habilitar mesas manualmente en tipos 'OTHER'
  await db.schema
    .alterTable('tenants')
    .addColumn('enable_tables', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();

  // 4. Índice para filtrar tenants por tipo de negocio en el backoffice
  await db.schema
    .createIndex('idx_tenants_business_type')
    .on('tenants')
    .column('business_type')
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('idx_tenants_business_type')
    .execute();

  await db.schema
    .alterTable('tenants')
    .dropColumn('enable_tables')
    .execute();

  await db.schema
    .alterTable('tenants')
    .dropColumn('custom_business_type')
    .execute();

  await db.schema
    .alterTable('tenants')
    .dropColumn('business_type')
    .execute();
}
