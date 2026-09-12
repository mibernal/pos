#!/usr/bin/env bash
# El dueño olvidó su contraseña y no hay correo con el que recuperarla.
#   sudo ./restablecer-clave.sh
# Pone una contraseña nueva al usuario dueño y cierra todas sus sesiones abiertas.
set -euo pipefail
DIR_SCRIPT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_comun.sh
. "$DIR_SCRIPT/_comun.sh"
exigir_root
cargar_env
read -r -s -p "Contraseña nueva para el dueño (mín. 10 caracteres, vacío = generar): " CLAVE; echo
GENERADA=0; [ -z "$CLAVE" ] && CLAVE="$(secreto 14)" && GENERADA=1
export PROV_NIT="$TENANT_NIT" PROV_DUENO_EMAIL="-" PROV_DUENO_PASSWORD="$CLAVE" PROV_RESET_PASSWORD=1
dc run --rm --no-deps -e PROV_NIT -e PROV_DUENO_EMAIL -e PROV_DUENO_PASSWORD -e PROV_RESET_PASSWORD \
  migrate node dist/shared/infra/db/provision-tenant.js
[ "$GENERADA" = 1 ] && echo "Contraseña nueva: $CLAVE"
ok "Listo. Las sesiones abiertas del dueño se cerraron."
