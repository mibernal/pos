#!/usr/bin/env bash
#
# Instala pos-dian en el mini-PC del comercio, sin necesitar internet.
#
#   sudo ./scripts/instalar.sh                 # interactivo
#   sudo ./scripts/instalar.sh comercio.env    # desatendido (ver comercio.env.ejemplo)
#
# Se ejecuta desde la carpeta del paquete descomprimido. Copia todo a /opt/pos-dian, carga
# las imágenes, genera secretos y certificados, crea el esquema y el comercio, y deja
# programados los respaldos. Repetirlo es seguro: no regenera secretos ni duplica el
# comercio si ya existen.
set -euo pipefail
PAQUETE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=_comun.sh
. "$PAQUETE/scripts/_comun.sh"
exigir_root

ARCHIVO_COMERCIO="${1:-}"
VERSION="$(cat "$PAQUETE/VERSION")"

echo
echo "${NEGRITA}pos-dian ${VERSION} — instalación local${NORMAL}"
echo

# ─── 1. Requisitos ──────────────────────────────────────────────────────────────────────────
[ "$(uname -s)" = "Linux" ] || fallar "Este instalador es para Linux (Ubuntu Server 24.04 recomendado)."
ARQ="$(uname -m)"
case "$ARQ" in x86_64|amd64) ;; *) aviso "Arquitectura $ARQ: el paquete se construyó para $(cat "$PAQUETE/PLATAFORMA" 2>/dev/null || echo linux/amd64)." ;; esac

if ! command -v docker >/dev/null 2>&1; then
  if [ -d "$PAQUETE/docker-debs" ]; then
    info "Docker no está instalado: instalando desde el paquete (sin internet)…"
    dpkg -i "$PAQUETE"/docker-debs/*.deb >/dev/null || fallar "No se pudo instalar Docker desde docker-debs/."
    systemctl enable --now docker >/dev/null
  else
    fallar "Docker no está instalado y el paquete no trae docker-debs/. Construye el paquete con --con-docker."
  fi
fi
docker compose version >/dev/null 2>&1 || fallar "Falta el plugin docker compose v2."
systemctl enable docker >/dev/null 2>&1 || true

LIBRE_GB=$(df -BG --output=avail /var/lib/docker 2>/dev/null | tail -1 | tr -dc '0-9' || echo 0)
[ "${LIBRE_GB:-0}" -ge 15 ] || aviso "Quedan ${LIBRE_GB} GB libres; se recomiendan al menos 15 GB (más los respaldos)."
command -v openssl >/dev/null || fallar "Falta openssl."

# ─── 2. Archivos ────────────────────────────────────────────────────────────────────────────
if [ -f "$PAQUETE/SHA256SUMS" ]; then
  info "Verificando integridad del paquete…"
  (cd "$PAQUETE" && sha256sum --quiet -c SHA256SUMS) || fallar "El paquete está dañado (SHA256 no coincide). Vuelve a copiarlo."
fi

mkdir -p "$POS_DIR"/{nginx,scripts,certs,licencia} "$RESPALDOS_DIR"
chmod 750 "$POS_DIR"; chmod 700 "$RESPALDOS_DIR"
cp "$PAQUETE/docker-compose.yml" "$POS_DIR/docker-compose.yml"
cp "$PAQUETE/nginx/onprem.conf" "$POS_DIR/nginx/onprem.conf"
cp "$PAQUETE"/scripts/*.sh "$POS_DIR/scripts/"; chmod +x "$POS_DIR"/scripts/*.sh
cp "$PAQUETE/VERSION" "$POS_DIR/VERSION"
[ -f "$PAQUETE/INSTALACION-ONPREM.md" ] && cp "$PAQUETE/INSTALACION-ONPREM.md" "$POS_DIR/"

info "Cargando imágenes (puede tardar unos minutos)…"
for img in "$PAQUETE"/imagenes/*.tar.gz; do
  gunzip -c "$img" | docker load >/dev/null || fallar "No se pudo cargar $img"
done
ok "Imágenes cargadas."

# ─── 3. Datos del comercio y secretos ───────────────────────────────────────────────────────
# En modo desatendido (con archivo) nunca se pregunta: lo que falte toma el valor por
# defecto, y si no hay defecto queda vacío (y se valida después).
preguntar() { # variable, texto, valor por defecto
  local var="$1" texto="$2" defecto="${3:-}" valor=""
  if [ -n "${!var:-}" ]; then return; fi
  if [ -n "$ARCHIVO_COMERCIO" ] || [ ! -t 0 ]; then
    printf -v "$var" '%s' "$defecto"; return
  fi
  if [ -n "$defecto" ]; then read -r -p "  $texto [$defecto]: " valor || true; else read -r -p "  $texto: " valor || true; fi
  printf -v "$var" '%s' "${valor:-$defecto}"
}

if [ -f "$POS_DIR/.env" ]; then
  ok "Ya existe $POS_DIR/.env: se conservan secretos y datos."
  cargar_env
  fijar_env POS_VERSION "$VERSION"
  PRIMERA_VEZ=0
else
  PRIMERA_VEZ=1
  if [ -n "$ARCHIVO_COMERCIO" ]; then
    [ -f "$ARCHIVO_COMERCIO" ] || fallar "No existe $ARCHIVO_COMERCIO"
    set -a; # shellcheck disable=SC1090
    . "$ARCHIVO_COMERCIO"; set +a
  else
    echo "${NEGRITA}Datos del comercio${NORMAL}"
  fi
  preguntar PROV_NIT "NIT (sin dígito de verificación)"
  preguntar PROV_RAZON_SOCIAL "Razón social"
  preguntar PROV_NOMBRE_COMERCIAL "Nombre comercial" "$PROV_RAZON_SOCIAL"
  preguntar PROV_TIPO_NEGOCIO "Tipo (RESTAURANT, CAFETERIA, BAR, MINIMARKET, SUPERMARKET, PHARMACY, BAKERY, OTHER…)" "OTHER"
  preguntar PROV_REGIMEN "Impuesto (IVA o INC_RESTAURANT)" "IVA"
  preguntar PROV_PLAN "Plan contratado (STARTER, PRO, ENTERPRISE)" "PRO"
  preguntar PROV_SUCURSAL "Nombre de la sede" "Sede Principal"
  preguntar PROV_DIRECCION "Dirección" "No especificada"
  preguntar PROV_CAJAS "Número de cajas" "1"
  echo "${NEGRITA}Usuario dueño${NORMAL}"
  preguntar PROV_DUENO_NOMBRE "Nombre"
  preguntar PROV_DUENO_EMAIL "Correo (es su usuario de ingreso)"
  for obligatoria in PROV_NIT PROV_RAZON_SOCIAL PROV_DUENO_EMAIL; do
    [ -n "${!obligatoria:-}" ] || fallar "Falta $obligatoria."
  done
  if [ -z "${PROV_DUENO_PASSWORD:-}" ]; then
    if [ -z "$ARCHIVO_COMERCIO" ] && [ -t 0 ]; then
      read -r -s -p "  Contraseña (mín. 10 caracteres, vacío = generar una): " PROV_DUENO_PASSWORD || true; echo
    fi
    [ -z "$PROV_DUENO_PASSWORD" ] && PROV_DUENO_PASSWORD="$(secreto 14)" && PASSWORD_GENERADA=1
  fi
  echo "${NEGRITA}Red y facturación${NORMAL}"
  preguntar POS_HOSTNAME "Nombre en la red local" "pos.local"
  preguntar DIAN_HTTP_URL "URL del PAC (vacío = configurar después)" ""
  preguntar DIAN_HTTP_API_KEY "API key del PAC (vacío = configurar después)" ""

  if [ -z "$DIAN_HTTP_URL" ] || [ -z "$DIAN_HTTP_API_KEY" ]; then
    aviso "Sin PAC configurado: las ventas se registran y los documentos DIAN quedan EN COLA hasta"
    aviso "configurarlo (scripts/configurar-pac.sh). Ningún documento se pierde, pero no se emite."
    DIAN_HTTP_URL="https://pac-pendiente.invalid/"
    DIAN_HTTP_API_KEY="PENDIENTE-CONFIGURAR"
  fi

  ORIGENES="https://${POS_HOSTNAME}"
  for ip in $(hostname -I 2>/dev/null || true); do
    case "$ip" in 10.*|192.168.*|172.*) ORIGENES="${ORIGENES},https://${ip}" ;; esac
  done

  LLAVE_LICENCIA=""
  [ -f "$PAQUETE/licencia-publica.pem" ] && LLAVE_LICENCIA="$(base64 -w0 "$PAQUETE/licencia-publica.pem")"

  umask 077
  cat > "$POS_DIR/.env" <<ENV
# Generado por instalar.sh el $(date '+%Y-%m-%d %H:%M'). Contiene secretos: no lo copies a
# ningún sitio sin cifrar. Un respaldo sin este archivo no sirve (las credenciales del PAC
# están cifradas con CREDENTIALS_ENCRYPTION_KEY).
POS_VERSION=${VERSION}
POS_HOSTNAME=${POS_HOSTNAME}
TENANT_NIT=${PROV_NIT}
POSTGRES_PASSWORD=$(secreto 40)
POS_API_PASSWORD=$(secreto 40)
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -hex 32)
DIAN_WEBHOOK_SECRET=$(openssl rand -hex 32)
METRICS_TOKEN=$(secreto 32)
CORS_ALLOWED_ORIGINS=${ORIGENES}
DIAN_HTTP_URL=${DIAN_HTTP_URL}
DIAN_HTTP_API_KEY=${DIAN_HTTP_API_KEY}
NOTIFICATION_PROVIDER=NONE
ONPREM_LICENSE_PUBLIC_KEY=${LLAVE_LICENCIA}
ENV
  umask 022
  chmod 600 "$POS_DIR/.env"
  cargar_env
  ok "Secretos generados en $POS_DIR/.env"
fi

[ -f "$POS_DIR/certs/servidor.crt" ] || POS_HOSTNAME="$POS_HOSTNAME" "$POS_DIR/scripts/certificados.sh"

# ─── 4. Base de datos ───────────────────────────────────────────────────────────────────────
info "Arrancando Postgres y Redis…"
dc up -d postgres redis >/dev/null
esperar_sano postgres 120 || fallar "Postgres no respondió. Revisa: docker compose logs postgres"

info "Aplicando migraciones…"
dc run --rm --no-deps migrate >/tmp/pos-migrate.log 2>&1 || { tail -30 /tmp/pos-migrate.log; fallar "Fallaron las migraciones."; }
ok "Esquema al día."

info "Preparando el rol de la API (sin BYPASSRLS)…"
dc run --rm --no-deps \
  -e SUPERUSER_DATABASE_URL="postgres://pos:${POSTGRES_PASSWORD}@postgres:5432/pos_dian" \
  migrate node dist/shared/infra/db/ensure-api-role.js "$POS_API_PASSWORD" >/tmp/pos-rol.log 2>&1 \
  || { tail -20 /tmp/pos-rol.log; fallar "No se pudo crear el rol pos_api."; }
rm -f /tmp/pos-rol.log   # imprime la contraseña: no se deja en disco
ok "Rol pos_api listo."

if [ "$PRIMERA_VEZ" = 1 ]; then
  info "Creando el comercio…"
  export PROV_NIT PROV_RAZON_SOCIAL PROV_NOMBRE_COMERCIAL PROV_TIPO_NEGOCIO PROV_REGIMEN PROV_PLAN \
    PROV_SUCURSAL PROV_DIRECCION PROV_CAJAS PROV_DUENO_NOMBRE PROV_DUENO_EMAIL PROV_DUENO_PASSWORD
  dc run --rm --no-deps \
    -e PROV_NIT -e PROV_RAZON_SOCIAL -e PROV_NOMBRE_COMERCIAL -e PROV_TIPO_NEGOCIO -e PROV_REGIMEN \
    -e PROV_PLAN -e PROV_SUCURSAL -e PROV_DIRECCION -e PROV_CAJAS -e PROV_DUENO_NOMBRE \
    -e PROV_DUENO_EMAIL -e PROV_DUENO_PASSWORD \
    migrate node dist/shared/infra/db/provision-tenant.js || fallar "No se pudo crear el comercio."
  ok "Comercio creado."
fi

# El volumen de imágenes nace de root; la API corre como uid 1001.
dc run --rm --no-deps --user root --entrypoint sh api -c 'chown -R 1001 /app/storage' >/dev/null

# ─── 5. Arranque ────────────────────────────────────────────────────────────────────────────
info "Arrancando la aplicación…"
dc up -d >/dev/null
esperar_sano api 180 || { dc logs --tail 40 api; fallar "La API no quedó sana."; }
esperar_sano web 90 || aviso "nginx tarda en quedar sano; revisa con scripts/estado.sh"
ok "pos-dian ${VERSION} en marcha."

# ─── 6. Respaldos y mantenimiento ───────────────────────────────────────────────────────────
cat > /etc/cron.d/pos-dian <<CRON
# pos-dian: respaldo diario 02:30 y validación de restauración los domingos 04:00.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 2 * * * root ${POS_DIR}/scripts/respaldo.sh >> /var/log/pos-dian-respaldo.log 2>&1
0 4 * * 0 root ${POS_DIR}/scripts/validar-respaldo.sh >> /var/log/pos-dian-respaldo.log 2>&1
CRON
chmod 644 /etc/cron.d/pos-dian
ok "Respaldo diario programado (02:30) en ${RESPALDOS_DIR}."

# Docker y la aplicación arrancan solos tras un corte de luz (restart: unless-stopped).
# Que el reloj no derive: la DIAN rechaza documentos con fecha futura.
timedatectl set-timezone America/Bogota 2>/dev/null || true

[ -z "${ONPREM_LICENSE_PUBLIC_KEY:-}" ] && aviso "El paquete no trae llave pública de licencia: el backoffice quedará degradado hasta configurarla."
[ -f "$POS_DIR/licencia/licencia.json" ] || aviso "Falta la licencia: copia licencia.json a $POS_DIR/licencia/ (scripts/instalar-licencia.sh)."

IP_PRINCIPAL="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "${NEGRITA}Listo.${NORMAL}"
echo "  En cada tablet/caja, primero:  http://${IP_PRINCIPAL}/instalar-certificado"
echo "  Después la aplicación:         https://${IP_PRINCIPAL}/   (o https://${POS_HOSTNAME}/)"
if [ "$PRIMERA_VEZ" = 1 ]; then
  echo "  Usuario:                       ${PROV_DUENO_EMAIL}"
  [ "${PASSWORD_GENERADA:-0}" = 1 ] && echo "  Contraseña generada:           ${PROV_DUENO_PASSWORD}   ← anótala y entrégala al dueño"
fi
echo "  Estado del sistema:            sudo ${POS_DIR}/scripts/estado.sh"
echo
echo "  ${AMARILLO}Guarda una copia cifrada de ${POS_DIR}/.env fuera de este equipo: sin ella, un respaldo no se puede restaurar.${NORMAL}"
