#!/usr/bin/env bash
#
# Actualiza a una versión nueva desde un paquete (USB o descargado), sin internet.
#
#   sudo ./actualizar.sh /media/usb/pos-dian-2026.11.02-ab12cd3.tar.gz
#   sudo ./actualizar.sh --revertir          # vuelve a la versión anterior Y a sus datos
#
# Orden: verificar paquete → respaldo → cargar imágenes → arrancar (las migraciones corren
# solas antes que la API) → comprobar salud. Si la API no queda sana, avisa y explica cómo
# revertir.
#
# Revertir restaura también la base del respaldo previo a la actualización: las migraciones
# solo van hacia adelante, y el código viejo sobre un esquema nuevo no es una combinación
# que nadie haya probado. Las ventas hechas entre la actualización y la reversión se
# pierden; por eso se revierte pronto o no se revierte.
set -euo pipefail
DIR_SCRIPT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_comun.sh
. "$DIR_SCRIPT/_comun.sh"
exigir_root
cargar_env

if [ "${1:-}" = "--revertir" ]; then
  ANTERIOR="${POS_VERSION_ANTERIOR:-}"
  RESPALDO="${RESPALDO_PRE_ACTUALIZACION:-}"
  [ -n "$ANTERIOR" ] && [ -f "$RESPALDO" ] || fallar "No hay una actualización reciente que revertir."
  docker image inspect "pos-dian/api:$ANTERIOR" >/dev/null 2>&1 || fallar "Las imágenes de $ANTERIOR ya no están en el equipo."
  aviso "Se volverá a $ANTERIOR y a los datos de $(basename "$RESPALDO")."
  fijar_env POS_VERSION "$ANTERIOR"
  echo "$ANTERIOR" > "$POS_DIR/VERSION"
  "$DIR_SCRIPT/restaurar.sh" "$RESPALDO"
  fijar_env POS_VERSION_ANTERIOR ""
  exit 0
fi

PAQUETE_TGZ="${1:-}"
[ -f "$PAQUETE_TGZ" ] || fallar "Uso: $0 <pos-dian-VERSION.tar.gz> | --revertir"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
info "Descomprimiendo paquete…"
tar xzf "$PAQUETE_TGZ" -C "$TMP"
NUEVO_DIR="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -f "$NUEVO_DIR/VERSION" ] || fallar "El archivo no parece un paquete de pos-dian."
NUEVA="$(cat "$NUEVO_DIR/VERSION")"
ACTUAL="$POS_VERSION"
[ "$NUEVA" != "$ACTUAL" ] || fallar "Ya estás en $ACTUAL."
(cd "$NUEVO_DIR" && sha256sum --quiet -c SHA256SUMS) || fallar "Paquete dañado (SHA256 no coincide)."

info "Respaldo previo a la actualización…"
"$DIR_SCRIPT/respaldo.sh"
RESPALDO="$(ls -1t "$RESPALDOS_DIR"/diario/pos-dian-*.dump | head -1)"
mkdir -p "$RESPALDOS_DIR/pre-actualizacion"
cp "$RESPALDO" "${RESPALDO%.dump}-imagenes.tar.gz" "$RESPALDOS_DIR/pre-actualizacion/" 2>/dev/null || true
RESPALDO="$RESPALDOS_DIR/pre-actualizacion/$(basename "$RESPALDO")"

info "Cargando imágenes de $NUEVA…"
for img in "$NUEVO_DIR"/imagenes/*.tar.gz; do gunzip -c "$img" | docker load >/dev/null; done

cp "$NUEVO_DIR/docker-compose.yml" "$POS_DIR/docker-compose.yml"
cp "$NUEVO_DIR/nginx/onprem.conf" "$POS_DIR/nginx/onprem.conf"
cp "$NUEVO_DIR"/scripts/*.sh "$POS_DIR/scripts/"; chmod +x "$POS_DIR"/scripts/*.sh
[ -f "$NUEVO_DIR/INSTALACION-ONPREM.md" ] && cp "$NUEVO_DIR/INSTALACION-ONPREM.md" "$POS_DIR/"
fijar_env POS_VERSION_ANTERIOR "$ACTUAL"
fijar_env RESPALDO_PRE_ACTUALIZACION "$RESPALDO"
fijar_env POS_VERSION "$NUEVA"
echo "$NUEVA" > "$POS_DIR/VERSION"

info "Arrancando $NUEVA (las migraciones corren primero)…"
if dc up -d --remove-orphans >/dev/null 2>&1 && esperar_sano api 240; then
  # Los permisos de las tablas nuevas los da ALTER DEFAULT PRIVILEGES; se reafirman igual.
  cargar_env
  dc run --rm --no-deps -e SUPERUSER_DATABASE_URL="postgres://pos:${POSTGRES_PASSWORD}@postgres:5432/pos_dian" \
    migrate node dist/shared/infra/db/ensure-api-role.js "$POS_API_PASSWORD" >/dev/null 2>&1 || true
  ok "Actualizado de $ACTUAL a $NUEVA."
  echo "  Las cajas verán «hay una versión nueva» y se actualizan solas cuando no haya una venta en curso."
  echo "  Si algo va mal hoy:  sudo $POS_DIR/scripts/actualizar.sh --revertir"
else
  dc logs --tail 60 migrate api 2>/dev/null || true
  fallar "La versión $NUEVA no quedó sana. Para volver a $ACTUAL:  sudo $POS_DIR/scripts/actualizar.sh --revertir"
fi
