#!/usr/bin/env bash
#
# Crea el rol de conexión de la API: un usuario SIN BYPASSRLS, de modo que el aislamiento
# entre comercios lo imponga PostgreSQL y no la disciplina de quien escribe las consultas.
#
#   ./infra/scripts/create-api-role.sh <contraseña>
#
# Requiere una conexión con el dueño del esquema (PGHOST/PGUSER/PGDATABASE o DATABASE_URL).
# Crea `api_user` si falta (es un rol del clúster; pg_dump no lo exporta).
#
# Alternativa sin necesidad de `psql`, útil cuando Postgres corre en Docker:
#   pnpm --filter @pos-dian/api db:ensure-api-role
set -euo pipefail

PASSWORD="${1:-}"
if [ -z "$PASSWORD" ]; then
  echo "Uso: $0 <contraseña-para-pos_api>" >&2
  echo "Genera una con: openssl rand -base64 32" >&2
  exit 1
fi

psql "${DATABASE_URL:-}" -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  -- api_user es un rol del CLÚSTER: pg_dump no lo exporta, así que restaurar un volcado o
  -- recrear el contenedor de Postgres lo deja fuera. Sin él, el CREATE USER de abajo falla
  -- con «role api_user does not exist».
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_user') THEN
    CREATE ROLE api_user NOLOGIN;
    RAISE NOTICE 'Rol api_user creado.';
  END IF;

  GRANT USAGE ON SCHEMA public TO api_user;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO api_user;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO api_user;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO api_user;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_user;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO api_user;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_api') THEN
    CREATE USER pos_api WITH PASSWORD '${PASSWORD}' IN ROLE api_user;
  ELSE
    ALTER USER pos_api WITH PASSWORD '${PASSWORD}';
    GRANT api_user TO pos_api;
  END IF;
END
\$\$;

-- Comprobación: si esto devuelve 't', el rol saltaría RLS y el aislamiento sería ficticio.
SELECT rolname, rolbypassrls AS salta_rls, rolsuper AS es_superusuario
FROM pg_roles WHERE rolname = 'pos_api';
SQL

echo
echo "Listo. Apunta DATABASE_URL de la API a este usuario:"
echo "  DATABASE_URL=postgres://pos_api:<contraseña>@<host>:5432/pos_dian"
echo
echo "El worker sigue necesitando el rol dueño: sus tareas programadas (bandeja de salida,"
echo "rollups, renovaciones) leen a través de todos los comercios por diseño."
