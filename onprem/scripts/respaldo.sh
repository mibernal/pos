#!/usr/bin/env bash
#
# Respaldo de la instalación local: base de datos + imágenes de productos.
#
#   sudo ./respaldo.sh
#
# Lo ejecuta cron todas las noches (02:30). Guarda en /var/backups/pos-dian:
#   - 14 respaldos diarios y 8 semanales (domingos), rotados solos.
#   - Si RESPALDO_EXTERNO apunta a un disco montado (USB, NAS), deja ahí una copia cifrada con
#     RESPALDO_CLAVE. Un respaldo en el mismo disco no sobrevive a que el disco se muera,
#     que es justo cuando hace falta.
#
# Variables opcionales en /opt/pos-dian/.env:
#   RESPALDO_EXTERNO=/media/respaldo-pos   RESPALDO_CLAVE=<frase larga>
set -euo pipefail
DIR_SCRIPT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_comun.sh
. "$DIR_SCRIPT/_comun.sh"
exigir_root
cargar_env

FECHA="$(date +%Y%m%d-%H%M)"
DESTINO="$RESPALDOS_DIR/diario"
mkdir -p "$DESTINO" "$RESPALDOS_DIR/semanal"
chmod 700 "$RESPALDOS_DIR"

DUMP="$DESTINO/pos-dian-$FECHA.dump"
IMAGENES="$DESTINO/pos-dian-$FECHA-imagenes.tar.gz"

echo "[$(date -Is)] Respaldo iniciado"

# Formato custom (-Fc): comprimido y restaurable tabla por tabla. Se escribe primero a un
# temporal: un respaldo a medias con el nombre bueno es peor que ninguno.
dc exec -T postgres pg_dump -U pos -d pos_dian -Fc --no-acl > "$DUMP.parcial"
dc exec -T postgres pg_restore --list < "$DUMP.parcial" > /dev/null \
  || { rm -f "$DUMP.parcial"; fallar "El volcado no es legible por pg_restore; se descarta."; }
mv "$DUMP.parcial" "$DUMP"

dc exec -T api tar czf - -C /app/storage . > "$IMAGENES.parcial" && mv "$IMAGENES.parcial" "$IMAGENES"

# La licencia y la configuración de nginx viajan con el respaldo; el .env NO (lleva
# secretos) salvo cifrado en la copia externa.
cp -f "$POS_DIR/licencia/licencia.json" "$DESTINO/pos-dian-$FECHA-licencia.json" 2>/dev/null || true
chmod 600 "$DESTINO"/pos-dian-"$FECHA"*

if [ "$(date +%u)" = "7" ]; then
  cp "$DUMP" "$IMAGENES" "$RESPALDOS_DIR/semanal/"
fi

# Rotación. Los `|| true`: con `pipefail`, un `ls` sin coincidencias (la primera semana
# no hay semanales) tumbaría el script antes de marcar el respaldo como bueno.
ls -1t "$DESTINO"/pos-dian-*.dump 2>/dev/null | tail -n +15 | while read -r f; do rm -f "$f" "${f%.dump}-imagenes.tar.gz" "${f%.dump}-licencia.json"; done || true
ls -1t "$RESPALDOS_DIR"/semanal/pos-dian-*.dump 2>/dev/null | tail -n +9 | while read -r f; do rm -f "$f" "${f%.dump}-imagenes.tar.gz"; done || true

if [ -n "${RESPALDO_EXTERNO:-}" ]; then
  if mountpoint -q "$RESPALDO_EXTERNO" 2>/dev/null || [ -d "$RESPALDO_EXTERNO" ]; then
    if [ -z "${RESPALDO_CLAVE:-}" ]; then
      aviso "RESPALDO_EXTERNO definido sin RESPALDO_CLAVE: no se copia sin cifrar."
    else
      PAQ="$RESPALDO_EXTERNO/pos-dian-$FECHA.tar.enc"
      tar cf - -C "$DESTINO" "$(basename "$DUMP")" "$(basename "$IMAGENES")" -C "$POS_DIR" .env \
        | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:RESPALDO_CLAVE -out "$PAQ"
      ls -1t "$RESPALDO_EXTERNO"/pos-dian-*.tar.enc 2>/dev/null | tail -n +31 | xargs -r rm -f || true
      ok "Copia externa cifrada: $PAQ"
    fi
  else
    aviso "RESPALDO_EXTERNO=$RESPALDO_EXTERNO no está montado: hoy no hay copia externa."
  fi
fi

date -Is > "$RESPALDOS_DIR/ultimo-respaldo-ok"
ok "Respaldo completo: $(du -h "$DUMP" | cut -f1) de base, $(du -h "$IMAGENES" | cut -f1) de imágenes."
