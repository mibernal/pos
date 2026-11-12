#!/usr/bin/env bash
# Configura (o cambia) la conexión con el PAC y reinicia el worker. Los documentos en cola
# se emiten solos en cuanto el PAC responde.
set -euo pipefail
DIR_SCRIPT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_comun.sh
. "$DIR_SCRIPT/_comun.sh"
exigir_root
cargar_env
read -r -p "URL del PAC: " URL
read -r -s -p "API key del PAC: " KEY; echo
[[ "$URL" =~ ^https:// ]] || fallar "La URL debe empezar por https://"
[ "${#KEY}" -ge 8 ] || fallar "La API key debe tener al menos 8 caracteres."
fijar_env DIAN_HTTP_URL "$URL"
fijar_env DIAN_HTTP_API_KEY "$KEY"
dc up -d --force-recreate worker api >/dev/null
ok "PAC configurado. Revisa en unos minutos con scripts/estado.sh"
