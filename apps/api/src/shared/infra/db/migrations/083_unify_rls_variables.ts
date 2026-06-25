import { sql, Kysely } from 'kysely';

const TABLES_WITH_POLICIES = [
  { table: 'delivery_persons', policy: 'tenant_isolation_delivery_persons' },
  { table: 'deliveries', policy: 'tenant_isolation_deliveries' },
  { table: 'delivery_items', policy: 'tenant_isolation_delivery_items' },
  { table: 'waiters', policy: 'tenant_isolation_waiters' },
  { table: 'kitchen_tickets', policy: 'tenant_isolation_kitchen_tickets' },
  { table: 'kitchen_ticket_items', policy: 'tenant_isolation_kitchen_ticket_items' },
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  for (const { table, policy } of TABLES_WITH_POLICIES) {
    // Eliminar la política con app.current_tenant_id
    await sql`DROP POLICY IF EXISTS ${sql.raw(policy)} ON ${sql.table(table)}`.execute(db);
    
    // Crear la política unificada con app.current_tenant
    await sql`
      CREATE POLICY ${sql.raw(policy)} ON ${sql.table(table)}
      AS RESTRICTIVE
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant', true))
    `.execute(db);

    // Asegurar que RLS esté forzado
    await sql`ALTER TABLE ${sql.table(table)} FORCE ROW LEVEL SECURITY`.execute(db);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  // Revertir a app.current_tenant_id
  for (const { table, policy } of TABLES_WITH_POLICIES) {
    await sql`DROP POLICY IF EXISTS ${sql.raw(policy)} ON ${sql.table(table)}`.execute(db);
    
    // Para revertir usamos el esquema anterior
    await sql`
      CREATE POLICY ${sql.raw(policy)} ON ${sql.table(table)}
      AS RESTRICTIVE
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    `.execute(db);
  }
}
