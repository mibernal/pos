import { sql, Kysely } from 'kysely';

/**
 * Migración 089 — Refresca los permisos del rol `api_user`.
 *
 * La migración 057 creó el rol y le concedió permisos sobre «todas las tablas» del
 * momento. Desde entonces se crearon decenas de tablas: sin este refresco, el rol con el
 * que la API se conecta en producción no puede tocarlas.
 *
 * Los `ALTER DEFAULT PRIVILEGES` cubren lo que se cree en el futuro, pero solo para
 * objetos creados por el rol que ejecuta esta migración (el dueño del esquema), que es
 * justamente el caso de las migraciones.
 *
 * Deliberadamente NO se concede DDL: la API no crea ni altera tablas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_user') THEN
        BEGIN
          CREATE ROLE api_user NOLOGIN;
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'Sin privilegios para crear el rol api_user. Se omite.';
        END;
      END IF;

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_user') THEN
        GRANT USAGE ON SCHEMA public TO api_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO api_user;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO api_user;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO api_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT USAGE, SELECT ON SEQUENCES TO api_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT EXECUTE ON FUNCTIONS TO api_user;
      END IF;
    END
    $$
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(_db: Kysely<any>): Promise<void> {
  // Revocar permisos dejaría la API sin acceso: la reversión se hace con la 057.
}
