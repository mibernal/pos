import { Kysely, sql } from 'kysely';

/**
 * Migración 104 — RLS para la liquidación de propinas.
 *
 * `tenant_tip_settings` tiene el comercio en la clave primaria y no en una columna
 * `tenant_id`, así que su política se escribe sobre esa columna; las otras dos siguen el
 * patrón habitual desde la 088.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  for (const table of ['tenant_tip_settings', 'tip_settlements', 'tip_settlement_items']) {
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
  for (const table of ['tip_settlement_items', 'tip_settlements', 'tenant_tip_settings']) {
    await sql`DROP POLICY IF EXISTS tenant_isolation_policy ON ${sql.raw(table)}`.execute(db);
    await sql`ALTER TABLE ${sql.raw(table)} NO FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.raw(table)} DISABLE ROW LEVEL SECURITY`.execute(db);
  }
}
