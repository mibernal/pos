#!/usr/bin/env bash
# Funciones compartidas por los scripts de la instalación local. No se ejecuta solo.

POS_DIR="${POS_DIR:-/opt/pos-dian}"
RESPALDOS_DIR="${RESPALDOS_DIR:-/var/backups/pos-dian}"

if [ -t 1 ]; then
  VERDE=$'\033[32m'; ROJO=$'\033[31m'; AMARILLO=$'\033[33m'; NEGRITA=$'\033[1m'; NORMAL=$'\033[0m'
else
  VERDE=''; ROJO=''; AMARILLO=''; NEGRITA=''; NORMAL=''
fi

info()   { echo "${NEGRITA}›${NORMAL} $*"; }
ok()     { echo "${VERDE}✓${NORMAL} $*"; }
aviso()  { echo "${AMARILLO}!${NORMAL} $*" >&2; }
fallar() { echo "${ROJO}✗ $*${NORMAL}" >&2; exit 1; }

exigir_root() {
  [ "$(id -u)" -eq 0 ] || fallar "Ejecuta este script con sudo."
}

# docker compose siempre con el mismo proyecto, archivo y .env, se llame desde donde se llame.
dc() {
  docker compose --project-name pos-dian --project-directory "$POS_DIR" \
    -f "$POS_DIR/docker-compose.yml" --env-file "$POS_DIR/.env" "$@"
}

cargar_env() {
  [ -f "$POS_DIR/.env" ] || fallar "No existe $POS_DIR/.env. ¿Se ejecutó instalar.sh?"
  set -a
  # shellcheck disable=SC1091
  . "$POS_DIR/.env"
  set +a
}

# Cambia (o añade) una clave del .env sin tocar las demás.
fijar_env() {
  local clave="$1" valor="$2" archivo="$POS_DIR/.env"
  if grep -q "^${clave}=" "$archivo"; then
    local tmp; tmp="$(mktemp)"
    awk -v k="$clave" -v v="$valor" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$archivo" > "$tmp"
    cat "$tmp" > "$archivo"; rm -f "$tmp"
  else
    echo "${clave}=${valor}" >> "$archivo"
  fi
}

esperar_sano() {
  local servicio="$1" limite="${2:-180}" t=0 estado
  while [ "$t" -lt "$limite" ]; do
    estado="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$(dc ps -q "$servicio" 2>/dev/null | head -1)" 2>/dev/null || echo '')"
    [ "$estado" = "healthy" ] && return 0
    sleep 3; t=$((t + 3))
  done
  return 1
}

secreto() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-"${1:-48}"; }
