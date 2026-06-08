import { sql, Kysely } from 'kysely';

/**
 * Migración 040 — Rol de base de datos para el worker con BYPASSRLS.
 *
 * CONTEXTO:
 * La migración 039 habilitó RLS en todas las tablas con tenant_id.
 * La política tenant_isolation_policy exige que app.current_tenant esté
 * configurado en la sesión de conexión.
 *
 * El worker opera en DOS modos distintos:
 *
 * 1. MODO CROSS-TENANT (schedulers):
 *    Los schedulers de rollup, alertas, housekeeping y recheck DIAN necesitan
 *    leer y escribir en TODAS las tablas de TODOS los tenants en una sola query.
 *    No es viable configurar app.current_tenant para un tenant en particular.
 *    → Necesita BYPASSRLS para que PostgreSQL ignore las políticas.
 *
 * 2. MODO PER-TENANT (processors de outbox BullMQ):
 *    Cada job procesa datos de un tenant específico (tenant_id viene del evento).
 *    Pueden (y deben) configurar app.current_tenant antes de sus queries.
 *    → No necesitan BYPASSRLS; usan set_config() por job.
 *
 * SOLUCIÓN:
 * Crear el rol `app_worker` con BYPASSRLS. El worker se conecta con este rol.
 * Los processors de outbox también usan este pool (BYPASSRLS) pero añaden
 * set_config() de forma adicional para activar la política RLS como segunda
 * capa de defensa (defense-in-depth: los filtros WHERE tenant_id = $1
 * siguen siendo la barrera principal en el worker).
 *
 * INSTRUCCIONES DE DEPLOY:
 * 1. Esta migración crea el rol `app_worker` si no existe.
 * 2. Crear el usuario DB para el worker:
 *      CREATE USER pos_worker WITH PASSWORD '<strong-password>' IN ROLE app_worker;
 *    O si el worker ya usa `pos`:
 *      GRANT app_worker TO pos;
 * 3. Configurar la variable de entorno del worker:
 *      DATABASE_URL=postgres://pos_worker:<password>@host:5432/pos_dian
 *    (o en dev puede seguir usando el mismo usuario `pos` al que se le otorga app_worker)
 */
export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // 1. Crear el rol app_worker con BYPASSRLS si no existe.
  //    NOLOGIN porque es un rol de grupo, no un usuario de conexión directa.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
        BEGIN
          CREATE ROLE app_worker NOLOGIN BYPASSRLS;
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'Insufficient privileges to create role. Skipping role creation. The app_worker role will need to be created manually by a database administrator.';
        END;
      END IF;
    END
    $$
  `.execute(db);

  // 2. Conceder al rol app_worker acceso a todas las tablas del schema public.
  // Solo lo hacemos si el rol existe, para evitar fallos si la creación falló arriba.
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_worker;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_worker;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_worker;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_worker;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_worker;
      END IF;
    END
    $$
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Revocar privilegios antes de eliminar el rol
  await sql`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM app_worker`.execute(db);
  await sql`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM app_worker`.execute(db);
  await sql`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM app_worker`.execute(db);
  await sql`DROP ROLE IF EXISTS app_worker`.execute(db);
}
