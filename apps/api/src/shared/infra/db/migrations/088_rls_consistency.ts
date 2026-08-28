import { sql, Kysely } from 'kysely';

/**
 * Migración 088 — Deja el aislamiento por tenant coherente en todo el esquema.
 *
 * Antes de esta migración el RLS estaba encendido pero era, en la práctica, decorativo:
 * la API se conectaba con el dueño del esquema, que salta las políticas. Al preparar el
 * cambio a un rol sin BYPASSRLS aparecieron tres defectos que lo habrían roto de golpe:
 *
 *  1. `order_rounds` y `tenant_dian_settings` usaban `app.current_tenant_id`, una variable
 *     que nadie fija (el resto del esquema usa `app.current_tenant`). Al aplicar RLS de
 *     verdad devolverían cero filas: rondas de cocina en blanco y, peor, ninguna credencial
 *     del PAC —es decir, ninguna factura emitida.
 *
 *  2. Seis tablas del módulo de restaurante y domicilios quedaron con política SOLO
 *     RESTRICTIVE. En PostgreSQL una restrictiva sin una permisiva que la acompañe niega
 *     todo: domicilios, meseros y cocina se habrían apagado por completo.
 *
 *  3. Doce tablas con `tenant_id` no tenían RLS en absoluto. Ahí el aislamiento dependía
 *     por entero de que ninguna consulta olvidara su `WHERE tenant_id`.
 *
 * Se documenta también, al final, qué tablas quedan deliberadamente fuera y por qué.
 */

/** Tablas cuya política usaba la variable equivocada. */
const WRONG_VARIABLE = [
  { table: 'order_rounds', policy: 'tenant_isolation_order_rounds' },
  { table: 'tenant_dian_settings', policy: 'tenant_isolation_dian_settings' }
] as const;

/** Tablas que quedaron con política solo RESTRICTIVE (niegan todo sin una permisiva). */
const RESTRICTIVE_ONLY = [
  { table: 'deliveries', policy: 'tenant_isolation_deliveries' },
  { table: 'delivery_items', policy: 'tenant_isolation_delivery_items' },
  { table: 'delivery_persons', policy: 'tenant_isolation_delivery_persons' },
  { table: 'waiters', policy: 'tenant_isolation_waiters' },
  { table: 'kitchen_tickets', policy: 'tenant_isolation_kitchen_tickets' },
  { table: 'kitchen_ticket_items', policy: 'tenant_isolation_kitchen_ticket_items' }
] as const;

/** Tablas con `tenant_id NOT NULL` que no tenían RLS. */
const UNPROTECTED = [
  'branches',
  'rooms',
  'tables',
  'reservations',
  'suppliers',
  'product_images',
  'product_modifier_groups',
  'product_modifier_options',
  'bulk_import_jobs',
  // Partición por defecto de audit_logs: la política del padre no filtra el acceso
  // directo a la partición.
  'audit_logs_default'
] as const;

/** Tablas que ya estaban bien pero sin FORCE (el dueño del esquema las saltaba). */
const MISSING_FORCE = ['table_orders', 'table_order_items', 'order_rounds', 'tenant_dian_settings'] as const;

const POLICY_NAME = 'tenant_isolation_policy';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyTenantPolicy(db: Kysely<any>, table: string, policy: string): Promise<void> {
  await sql`ALTER TABLE ${sql.table(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`DROP POLICY IF EXISTS ${sql.raw(policy)} ON ${sql.table(table)}`.execute(db);

  // PERMISSIVE (el valor por defecto) y con `app.current_tenant`, igual que el resto del
  // esquema. `current_setting(..., true)` devuelve NULL si nadie fijó la variable, de modo
  // que la comparación es falsa y la tabla queda vacía: falla cerrado, no abierto.
  await sql`
    CREATE POLICY ${sql.raw(policy)} ON ${sql.table(table)}
    FOR ALL
    USING (tenant_id::text = current_setting('app.current_tenant', true))
  `.execute(db);

  await sql`ALTER TABLE ${sql.table(table)} FORCE ROW LEVEL SECURITY`.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  for (const { table, policy } of WRONG_VARIABLE) {
    await applyTenantPolicy(db, table, policy);
  }

  for (const { table, policy } of RESTRICTIVE_ONLY) {
    await applyTenantPolicy(db, table, policy);
  }

  for (const table of UNPROTECTED) {
    await applyTenantPolicy(db, table, POLICY_NAME);
  }

  for (const table of MISSING_FORCE) {
    await sql`ALTER TABLE ${sql.table(table)} FORCE ROW LEVEL SECURITY`.execute(db);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  for (const table of UNPROTECTED) {
    await sql`DROP POLICY IF EXISTS ${sql.raw(POLICY_NAME)} ON ${sql.table(table)}`.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} NO FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} DISABLE ROW LEVEL SECURITY`.execute(db);
  }

  for (const table of MISSING_FORCE) {
    await sql`ALTER TABLE ${sql.table(table)} NO FORCE ROW LEVEL SECURITY`.execute(db);
  }

  // Las políticas de WRONG_VARIABLE y RESTRICTIVE_ONLY no se revierten a su forma anterior
  // a propósito: eran incorrectas y volver a ellas dejaría el esquema roto.
}
