import { sql, Kysely } from 'kysely';

/**
 * Migración 057 — Rol de base de datos para la API sin BYPASSRLS.
 *
 * CONTEXTO:
 * La migración 039 habilitó RLS en todas las tablas con tenant_id.
 * Sin embargo, la API actualmente se conecta usando el usuario `pos`, el cual 
 * es un superusuario o tiene permisos elevados (posiblemente BYPASSRLS heredado o dueño de tablas),
 * haciendo que las políticas de RLS sean ignoradas si el desarrollador no usa la abstracción adecuada.
 *
 * SOLUCIÓN:
 * Crear el rol `api_user` SIN privilegios de bypass RLS. La API se conectará con un
 * usuario que asuma este rol, forzando la evaluación de las políticas RLS.
 *
 * INSTRUCCIONES DE DEPLOY:
 * 1. Esta migración crea el rol `api_user` si no existe.
 * 2. Crear el usuario DB para la API:
 *      CREATE USER pos_api WITH PASSWORD '<strong-password>' IN ROLE api_user;
 * 3. En la transición, el código de la API deberá refactorizarse para usar `executeAsTenant`.
 */
export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // 1. Crear el rol api_user sin BYPASSRLS (NOBYPASSRLS es el default, pero lo ponemos explícito si queremos, aunque no es válido en CREATE ROLE, simplemente omitimos BYPASSRLS)
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_user') THEN
        BEGIN
          CREATE ROLE api_user NOLOGIN;
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'Insufficient privileges to create role. Skipping role creation.';
        END;
      END IF;
    END
    $$
  `.execute(db);

  // 2. Conceder al rol api_user acceso DML a todas las tablas del schema public.
  //    No concedemos DDL (CREATE, DROP, ALTER).
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO api_user;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO api_user;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO api_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO api_user;
      END IF;
    END
    $$
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Revocar privilegios antes de eliminar el rol
  await sql`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM api_user`.execute(db);
  await sql`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM api_user`.execute(db);
  await sql`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM api_user`.execute(db);
  await sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM api_user`.execute(db);
  await sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM api_user`.execute(db);
  await sql`DROP ROLE IF EXISTS api_user`.execute(db);
}
