import { sql, Kysely } from 'kysely';

/**
 * Migración 093 — Los permisos por defecto tienen que pertenecer al rol que migra.
 *
 * La 089 refrescó los `GRANT` de `api_user` y dejó configurados los `ALTER DEFAULT
 * PRIVILEGES` para cubrir las tablas futuras. La nota de esa migración lo dice bien: los
 * permisos por defecto **solo aplican a los objetos creados por el rol que los configuró**.
 * Lo que no se comprobó es qué rol los había configurado.
 *
 * En una base real, `pg_default_acl` los tenía a nombre de `postgres`, mientras que las
 * migraciones corren con `ADMIN_DATABASE_URL`, que es el dueño del esquema (`pos`). El
 * resultado: **cada tabla nueva que crea una migración nace invisible para la API**, con
 * un `permission denied` que no aparece hasta que alguien usa la funcionalidad nueva. Lo
 * descubrió la tabla `payment_webhook_events` de la 092 — el registro de webhooks fallaba
 * en silencio dentro de su propio `catch`, que es la peor forma posible de enterarse.
 *
 * Esta migración se ejecuta **como el rol que migra**, así que los permisos por defecto
 * quedan a su nombre y cubren de verdad lo que ese rol cree a partir de ahora. El `GRANT`
 * sobre las tablas existentes recoge de paso las que ya nacieron huérfanas.
 *
 * Sigue sin concederse DDL: la API no crea ni altera tablas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_user') THEN
        -- Recoge las tablas que se crearon después de la 089 sin heredar permisos.
        GRANT USAGE ON SCHEMA public TO api_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO api_user;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO api_user;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO api_user;

        -- Sin FOR ROLE: se registran a nombre de CURRENT_USER, que es el rol que está
        -- ejecutando esta migración y el que creará las tablas de las migraciones futuras.
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT USAGE, SELECT ON SEQUENCES TO api_user;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT EXECUTE ON FUNCTIONS TO api_user;
      ELSE
        RAISE NOTICE 'El rol api_user no existe todavía; los permisos los aplica infra/scripts/create-api-role.sh.';
      END IF;
    END
    $$
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(_db: Kysely<any>): Promise<void> {
  // Revocar dejaría la API sin acceso a las tablas nuevas. La reversión es la 057.
}
