#!/usr/bin/env bash
#
# Crea el rol de conexión de la API: un usuario SIN BYPASSRLS, de modo que el aislamiento
# entre comercios lo imponga PostgreSQL y no la disciplina de quien escribe las consultas.
#
#   ./infra/scripts/create-api-role.sh <contraseña>
#
# Requiere una conexión con el dueño del esquema (PGHOST/PGUSER/PGDATABASE o DATABASE_URL).
# Ejecutar DESPUÉS de las migraciones: el rol `api_user` lo crea la migración 057/089.
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
