#!/usr/bin/env bash
#
# Diagnóstico rápido. Es lo primero que se ejecuta cuando el comercio llama.
#
#   sudo ./estado.sh
set -uo pipefail
DIR_SCRIPT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_comun.sh
. "$DIR_SCRIPT/_comun.sh"
exigir_root
cargar_env

echo "${NEGRITA}pos-dian $(cat "$POS_DIR/VERSION" 2>/dev/null)${NORMAL} en $(hostname) — $(date '+%Y-%m-%d %H:%M')"
echo
dc ps --format 'table {{.Service}}\t{{.Status}}'
echo

psql_() { dc exec -T postgres psql -U pos -d pos_dian -qAt -F ' ' -c "$1" 2>/dev/null; }

echo "${NEGRITA}Facturación electrónica${NORMAL}"
if [ "${DIAN_HTTP_API_KEY:-}" = "PENDIENTE-CONFIGURAR" ]; then
  echo "  ${ROJO}PAC sin configurar: los documentos se acumulan en cola. scripts/configurar-pac.sh${NORMAL}"
fi
psql_ "SELECT '  documentos ' || status || ': ' || count(*) FROM dian_documents GROUP BY status ORDER BY status" || echo "  (sin datos)"
PEND="$(psql_ "SELECT count(*) FROM outbox_events WHERE status IN ('PENDING','FAILED')" || echo '?')"
VIEJO="$(psql_ "SELECT coalesce(round(extract(epoch FROM now() - min(created_at))/3600), 0) FROM outbox_events WHERE status IN ('PENDING','FAILED')" || echo '?')"
echo "  eventos pendientes en outbox: ${PEND} (el más antiguo: ${VIEJO} h)"
if [ "${VIEJO:-0}" != "?" ] && [ "${VIEJO:-0}" -ge 24 ] 2>/dev/null; then
  echo "  ${AMARILLO}Hay documentos de hace más de un día sin emitir: revisa internet y el PAC.${NORMAL}"
fi
if curl -s -m 5 -o /dev/null https://www.dian.gov.co 2>/dev/null; then echo "  internet: ${VERDE}sí${NORMAL}"; else echo "  internet: ${AMARILLO}no${NORMAL} (la caja sigue vendiendo; se emite al volver)"; fi
echo

echo "${NEGRITA}Licencia${NORMAL}"
LIC="$(dc logs --no-log-prefix --since 168h worker 2>/dev/null | grep -E 'onprem_license_(ok|degraded)' | tail -1)"
if [ -n "$LIC" ]; then echo "  $LIC" | cut -c1-220; else echo "  sin registro reciente"; fi
psql_ "SELECT '  suscripción: ' || status || ' · plan ' || plan_id || ' · hasta ' || to_char(expires_at,'YYYY-MM-DD') FROM tenant_subscriptions ORDER BY created_at DESC LIMIT 1"
echo

echo "${NEGRITA}Respaldos${NORMAL}"
for f in ultimo-respaldo-ok ultima-validacion-ok; do
  if [ -f "$RESPALDOS_DIR/$f" ]; then
    EDAD=$(( ( $(date +%s) - $(date -d "$(cat "$RESPALDOS_DIR/$f")" +%s) ) / 3600 ))
    COLOR="$VERDE"; [ "$EDAD" -gt 36 ] && [ "$f" = ultimo-respaldo-ok ] && COLOR="$ROJO"
    echo "  $f: ${COLOR}hace ${EDAD} h${NORMAL}"
  else
    echo "  $f: ${ROJO}nunca${NORMAL}"
  fi
done
echo "  copias en disco: $(ls "$RESPALDOS_DIR"/diario/*.dump 2>/dev/null | wc -l) diarias, $(ls "$RESPALDOS_DIR"/semanal/*.dump 2>/dev/null | wc -l) semanales"
[ -n "${RESPALDO_EXTERNO:-}" ] || echo "  ${AMARILLO}sin copia externa (RESPALDO_EXTERNO): si el disco muere, se pierde todo${NORMAL}"
echo

echo "${NEGRITA}Equipo${NORMAL}"
echo "  disco: $(df -h /var/lib/docker | tail -1 | awk '{print $4 " libres de " $2 " (" $5 " usado)"}')"
echo "  memoria: $(free -h | awk '/Mem:/ {print $7 " disponibles de " $2}')"
echo "  IPs: $(hostname -I)"
echo "  certificado vence: $(openssl x509 -enddate -noout -in "$POS_DIR/certs/servidor.crt" 2>/dev/null | cut -d= -f2)"
echo "  reloj: $(timedatectl show -p NTPSynchronized --value 2>/dev/null | sed 's/yes/sincronizado/;s/no/SIN sincronizar (revisa la hora: la DIAN rechaza fechas erradas)/')"
