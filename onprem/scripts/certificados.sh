#!/usr/bin/env bash
#
# Certificados HTTPS para la red del local, sin internet.
#
#   sudo ./certificados.sh            # crea la CA (si no existe) y el certificado del servidor
#   sudo ./certificados.sh --renovar  # rehace solo el del servidor (cambió la IP o el nombre)
#
# Por qué una CA propia: el service worker (modo offline), la báscula/impresora por Web
# Serial y la cámara exigen HTTPS, y `http://` solo cuenta como seguro en `localhost`, no en
# la IP del mini-PC vista desde una tablet. Sin internet no hay Let's Encrypt, así que se
# genera una autoridad del local (10 años) y se instala UNA vez en cada dispositivo. El
# certificado del servidor se puede rehacer cuantas veces haga falta con la misma CA, sin
# volver a tocar las tablets.
set -euo pipefail
DIR_SCRIPT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_comun.sh
. "$DIR_SCRIPT/_comun.sh"
exigir_root

CERTS="$POS_DIR/certs"
mkdir -p "$CERTS"; chmod 700 "$CERTS"

NOMBRE="${POS_HOSTNAME:-}"
[ -z "$NOMBRE" ] && [ -f "$POS_DIR/.env" ] && NOMBRE="$(grep '^POS_HOSTNAME=' "$POS_DIR/.env" | cut -d= -f2-)"
NOMBRE="${NOMBRE:-pos.local}"

if [ ! -f "$CERTS/ca.key" ]; then
  info "Creando la autoridad certificadora del local…"
  openssl ecparam -name prime256v1 -genkey -noout -out "$CERTS/ca.key"
  openssl req -x509 -new -key "$CERTS/ca.key" -sha256 -days 3650 \
    -subj "/O=POS DIAN Local/CN=POS DIAN CA $(hostname) $(date +%Y%m%d)" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out "$CERTS/ca.crt"
  chmod 600 "$CERTS/ca.key"
  ok "CA creada (válida 10 años)."
fi

# Todas las IPv4 privadas del equipo entran al certificado: así sirve tanto por IP como por
# nombre, y si el equipo tiene cable y wifi, por cualquiera de las dos.
SAN="DNS:${NOMBRE},DNS:localhost,IP:127.0.0.1"
for ip in $(hostname -I 2>/dev/null || true); do
  case "$ip" in
    10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) SAN="${SAN},IP:${ip}" ;;
  esac
done
[ -n "${POS_IPS_EXTRA:-}" ] && for ip in $POS_IPS_EXTRA; do SAN="${SAN},IP:${ip}"; done

info "Certificado del servidor para: ${SAN}"
openssl ecparam -name prime256v1 -genkey -noout -out "$CERTS/servidor.key"
openssl req -new -key "$CERTS/servidor.key" -subj "/CN=${NOMBRE}" -out "$CERTS/servidor.csr"
# 825 días: el máximo que aceptan iOS y macOS para certificados de una CA privada.
openssl x509 -req -in "$CERTS/servidor.csr" -CA "$CERTS/ca.crt" -CAkey "$CERTS/ca.key" \
  -CAcreateserial -days 825 -sha256 \
  -extfile <(printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature\nbasicConstraints=CA:FALSE\n" "$SAN") \
  -out "$CERTS/servidor.crt"
rm -f "$CERTS/servidor.csr"
# nginx corre como root dentro del contenedor para leerla; fuera, solo root.
chmod 600 "$CERTS/servidor.key"; chmod 644 "$CERTS/servidor.crt" "$CERTS/ca.crt"
ok "Certificado del servidor listo (vence $(openssl x509 -enddate -noout -in "$CERTS/servidor.crt" | cut -d= -f2))."

# Con --renovar (cambió la IP del equipo), además de rehacer el certificado se actualizan
# los orígenes permitidos: la PWA manda `Origin` en cada POST y la API rechaza los que no
# conoce, así que una IP nueva sin esto deja a las cajas sin poder vender.
if [ "${1:-}" = "--renovar" ] && [ -f "$POS_DIR/.env" ]; then
  ORIGENES="https://${NOMBRE}"
  for ip in $(hostname -I 2>/dev/null || true); do
    case "$ip" in 10.*|192.168.*|172.*) ORIGENES="${ORIGENES},https://${ip}" ;; esac
  done
  [ -n "${POS_IPS_EXTRA:-}" ] && for ip in $POS_IPS_EXTRA; do ORIGENES="${ORIGENES},https://${ip}"; done
  fijar_env CORS_ALLOWED_ORIGINS "$ORIGENES"
  ok "Orígenes permitidos: ${ORIGENES}"
  if [ -n "$(dc ps -q api 2>/dev/null)" ]; then
    dc up -d --force-recreate api web >/dev/null && ok "API y nginx reiniciados con la configuración nueva."
  fi
fi
