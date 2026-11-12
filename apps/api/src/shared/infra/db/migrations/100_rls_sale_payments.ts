import { Kysely, sql } from 'kysely';

/**
 * Migración 100 — RLS para los pagos y el catálogo de medios.
 *
 * Misma regla desde la 088: toda tabla con `tenant_id` la aísla PostgreSQL, no la
 * disciplina de quien escribe la consulta. Aquí importa doblemente porque `sale_payments`
 * es la nueva fuente de verdad del dinero: un pago del comercio equivocado en una suma del
 * turno no es una fila de más, es un arqueo que no cuadra y nadie sabe por qué.
 */
const TENANT_TABLES = ['payment_method_catalog', 'sale_payments'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  for (const table of TENANT_TABLES) {
    await sql`ALTER TABLE ${sql.raw(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.raw(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`
      CREATE POLICY tenant_isolation_policy ON ${sql.raw(table)}
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
    `.execute(db);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  for (const table of [...TENANT_TABLES].reverse()) {
    await sql`DROP POLICY IF EXISTS tenant_isolation_policy ON ${sql.raw(table)}`.execute(db);
    await sql`ALTER TABLE ${sql.raw(table)} NO FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.raw(table)} DISABLE ROW LEVEL SECURITY`.execute(db);
  }
}
