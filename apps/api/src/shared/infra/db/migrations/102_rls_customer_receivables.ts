import { Kysely, sql } from 'kysely';

/**
 * Migración 102 — RLS para las cuentas por cobrar.
 *
 * Cuatro tablas con `tenant_id`, y la deuda de un cliente es de las cosas más sensibles que
 * guarda el sistema: quién debe, cuánto y desde cuándo. La misma regla desde la 088 —el
 * aislamiento lo aplica PostgreSQL, no la disciplina de quien escribe la consulta.
 */
const TENANT_TABLES = [
  'customer_credit_accounts',
  'customer_receivables',
  'customer_payments',
  'customer_payment_allocations'
];

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
