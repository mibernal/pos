#!/usr/bin/env bash
#
# Restaura un respaldo sobre la instalación actual. DESTRUYE los datos actuales.
#
#   sudo ./restaurar.sh /var/backups/pos-dian/diario/pos-dian-20261020-0230.dump
#   sudo ./restaurar.sh /media/usb/pos-dian-20261020-0230.tar.enc     # copia externa cifrada
#
# Antes de tocar nada hace un respaldo de lo que hay, por si el restaurado era el equivocado.
set -euo pipefail
DIR_SCRIPT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_comun.sh
. "$DIR_SCRIPT/_comun.sh"
exigir_root

ORIGEN="${1:-}"
[ -f "$ORIGEN" ] || fallar "Uso: $0 <archivo .dump o .tar.enc>"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

if [[ "$ORIGEN" == *.tar.enc ]]; then
  read -r -s -p "Clave del respaldo externo: " CLAVE; echo
  CLAVE="$CLAVE" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:CLAVE -in "$ORIGEN" | tar xf - -C "$TMP" \
    || fallar "No se pudo descifrar (¿clave equivocada?)."
  DUMP="$(ls "$TMP"/*.dump | head -1)"
  IMAGENES="$(ls "$TMP"/*-imagenes.tar.gz 2>/dev/null | head -1 || true)"
  if [ ! -f "$POS_DIR/.env" ] && [ -f "$TMP/.env" ]; then
    cp "$TMP/.env" "$POS_DIR/.env"; chmod 600 "$POS_DIR/.env"
    ok "Se recuperó el .env del respaldo (equipo nuevo)."
  fi
else
  DUMP="$ORIGEN"
  IMAGENES="${ORIGEN%.dump}-imagenes.tar.gz"; [ -f "$IMAGENES" ] || IMAGENES=""
fi
cargar_env

echo "${ROJO}${NEGRITA}Esto reemplaza TODOS los datos actuales por los de $(basename "$DUMP").${NORMAL}"
read -r -p "Escribe RESTAURAR para continuar: " CONFIRMA
[ "$CONFIRMA" = "RESTAURAR" ] || fallar "Cancelado."

if dc ps -q postgres >/dev/null 2>&1 && [ -n "$(dc ps -q postgres)" ]; then
  info "Respaldo de seguridad de lo actual…"
  "$DIR_SCRIPT/respaldo.sh" || aviso "No se pudo respaldar lo actual (¿base vacía o dañada?). Sigo."
fi

info "Deteniendo la aplicación…"
dc stop web api worker >/dev/null 2>&1 || true
dc up -d postgres redis >/dev/null
esperar_sano postgres 120 || fallar "Postgres no arrancó."

psql_() { dc exec -T postgres psql -U pos -v ON_ERROR_STOP=1 -qAt "$@"; }
psql_ -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='pos_dian' AND pid<>pg_backend_pid()" >/dev/null
psql_ -d postgres -c "DROP DATABASE IF EXISTS pos_dian" >/dev/null
psql_ -d postgres -c "CREATE DATABASE pos_dian OWNER pos" >/dev/null
info "Restaurando base…"
dc exec -T postgres pg_restore -U pos -d pos_dian --no-owner --exit-on-error < "$DUMP"

# Los permisos del rol de la API no viajan en el volcado (--no-acl): se rehacen.
dc run --rm --no-deps -e SUPERUSER_DATABASE_URL="postgres://pos:${POSTGRES_PASSWORD}@postgres:5432/pos_dian" \
  migrate node dist/shared/infra/db/ensure-api-role.js "$POS_API_PASSWORD" >/dev/null

if [ -n "$IMAGENES" ]; then
  info "Restaurando imágenes de productos…"
  dc run --rm --no-deps --user root --entrypoint sh -v "$(dirname "$IMAGENES"):/respaldo:ro" api \
    -c "rm -rf /app/storage/* && tar xzf /respaldo/$(basename "$IMAGENES") -C /app/storage && chown -R 1001 /app/storage" >/dev/null
fi

# La cola de Redis puede apuntar a eventos que ya no existen: se vacía; el worker la
# reconstruye desde el outbox de Postgres, que es la fuente de verdad.
dc exec -T redis redis-cli FLUSHALL >/dev/null

dc up -d >/dev/null
esperar_sano api 180 || fallar "La API no arrancó tras restaurar."
ok "Restaurado. Revisa con scripts/estado.sh"
