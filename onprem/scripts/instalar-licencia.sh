#!/usr/bin/env bash
# Instala o renueva la licencia: sudo ./instalar-licencia.sh /media/usb/licencia.json
set -euo pipefail
DIR_SCRIPT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_comun.sh
. "$DIR_SCRIPT/_comun.sh"
exigir_root
ARCHIVO="${1:-}"
[ -f "$ARCHIVO" ] || fallar "Uso: $0 <licencia.json>"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert "payload" in d and "firma" in d' "$ARCHIVO" 2>/dev/null \
  || fallar "El archivo no tiene formato de licencia."
mkdir -p "$POS_DIR/licencia"
install -m 644 "$ARCHIVO" "$POS_DIR/licencia/licencia.json"
# Reiniciar el worker fuerza la verificación ya, sin esperar a la próxima pasada (6 h).
dc restart worker >/dev/null
sleep 8
dc logs --no-log-prefix --since 1m worker 2>/dev/null | grep -E 'onprem_license_(ok|degraded)' | tail -1 | cut -c1-240
ok "Licencia copiada. Si arriba dice onprem_license_ok, quedó vigente."
