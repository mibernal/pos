import { Kysely, sql } from 'kysely';

/**
 * Migración 096 — RLS para las excepciones por comercio.
 *
 * `tenant_module_overrides` y `tenant_limit_overrides` llevan `tenant_id`, así que entran en
 * la misma regla que el resto: el aislamiento lo aplica PostgreSQL, no la disciplina de
 * quien escribe la consulta. La fase 2 encontró diez tablas con `tenant_id` y sin RLS
 * precisamente por no aplicar esta regla al crearlas.
 *
 * `plan_entitlements` y `plan_modules` quedan fuera a propósito: son catálogo global, igual
 * que `billing_plans`. Todos los comercios ven los mismos planes.
 *
 * Política PERMISSIVE con `app.current_tenant` y `FORCE`, como la 088 dejó el resto del
 * esquema — para que el dueño tampoco se salte el aislamiento por descuido.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  for (const table of ['tenant_module_overrides', 'tenant_limit_overrides']) {
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
  for (const table of ['tenant_limit_overrides', 'tenant_module_overrides']) {
    await sql`DROP POLICY IF EXISTS tenant_isolation_policy ON ${sql.raw(table)}`.execute(db);
    await sql`ALTER TABLE ${sql.raw(table)} NO FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.raw(table)} DISABLE ROW LEVEL SECURITY`.execute(db);
  }
}
