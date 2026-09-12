#!/usr/bin/env bash
#
# Comprueba que el último respaldo se puede restaurar de verdad.
#
# Lo restaura en una base aparte (`pos_dian_validacion`) del mismo Postgres, cuenta filas
# de las tablas que importan y la borra. Un respaldo que nunca se probó es una esperanza,
# no un respaldo. Lo ejecuta cron los domingos.
set -euo pipefail
DIR_SCRIPT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_comun.sh
. "$DIR_SCRIPT/_comun.sh"
exigir_root
cargar_env

ULTIMO="$(ls -1t "$RESPALDOS_DIR"/diario/pos-dian-*.dump 2>/dev/null | head -1 || true)"
[ -n "$ULTIMO" ] || fallar "No hay respaldos que validar."

echo "[$(date -Is)] Validando $ULTIMO"
psql_() { dc exec -T postgres psql -U pos -v ON_ERROR_STOP=1 -qAt "$@"; }

psql_ -d postgres -c "DROP DATABASE IF EXISTS pos_dian_validacion" >/dev/null
psql_ -d postgres -c "CREATE DATABASE pos_dian_validacion" >/dev/null
trap 'psql_ -d postgres -c "DROP DATABASE IF EXISTS pos_dian_validacion" >/dev/null 2>&1 || true' EXIT

dc exec -T postgres pg_restore -U pos -d pos_dian_validacion --no-owner --exit-on-error < "$ULTIMO"

VENTAS_RESPALDO="$(psql_ -d pos_dian_validacion -c 'SELECT count(*) FROM sales')"
VENTAS_VIVO="$(psql_ -d pos_dian -c 'SELECT count(*) FROM sales')"
MIGRACIONES="$(psql_ -d pos_dian_validacion -c 'SELECT count(*) FROM kysely_migration' 2>/dev/null || echo '?')"

if [ "$VENTAS_RESPALDO" -gt "$VENTAS_VIVO" ]; then
  fallar "El respaldo tiene más ventas ($VENTAS_RESPALDO) que la base viva ($VENTAS_VIVO): algo raro pasa."
fi

date -Is > "$RESPALDOS_DIR/ultima-validacion-ok"
ok "Respaldo restaurable: $VENTAS_RESPALDO ventas (vivo: $VENTAS_VIVO), $MIGRACIONES migraciones."
