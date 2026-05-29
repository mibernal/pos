import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Tabla de asignación de sucursales a usuarios
  await db.schema
    .createTable('user_branches')
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    .addColumn('assigned_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addPrimaryKeyConstraint('pk_user_branches', ['tenant_id', 'user_id', 'branch_id'])
    .execute();

  // 2. Backfill: Si los roles eran globales, asignaremos a los usuarios existentes a TODAS las sucursales de su tenant 
  // (para no romperles el acceso actual a las tiendas de prueba)
  await sql`
    INSERT INTO user_branches (tenant_id, user_id, branch_id)
    SELECT u.tenant_id, u.id, b.id
    FROM users u
    JOIN branches b ON b.tenant_id = u.tenant_id
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_branches').execute();
}
