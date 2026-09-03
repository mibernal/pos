import { Kysely, sql } from 'kysely';

/**
 * Migración 098 — RLS para las tablas de facturación recurrente.
 *
 * Toda tabla con `tenant_id` entra en la misma regla desde la 088: el aislamiento lo aplica
 * PostgreSQL, no la disciplina de quien escribe la consulta. Aquí importa especialmente,
 * porque son las tablas donde vive el dinero: una factura del comercio equivocado no es un
 * dato de más en una lista, es una cifra en el estado de cuenta de otro.
 *
 * `billing_coupons` y `billing_invoice_sequences` quedan fuera: son catálogo de plataforma,
 * como `billing_plans`. El consecutivo es uno solo porque el que factura somos nosotros.
 */
const TENANT_TABLES = [
  'tenant_payment_methods',
  'subscription_invoices',
  'subscription_invoice_items',
  'dunning_events',
  'tenant_coupon_redemptions'
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
