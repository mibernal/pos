#!/usr/bin/env bash
#
# Construye el paquete de instalación local. Se ejecuta en TU equipo (con internet), desde
# la raíz del repositorio, nunca en el del comercio.
#
#   ./onprem/scripts/construir-paquete.sh                  # versión = fecha-commit
#   ./onprem/scripts/construir-paquete.sh 1.4.0            # versión explícita
#   ./onprem/scripts/construir-paquete.sh 1.4.0 --con-docker   # incluye Docker para Ubuntu 24.04
#
# Resultado: onprem/paquete/pos-dian-<versión>.tar.gz, listo para copiar a una USB.
#
# Las imágenes se construyen para linux/amd64 (mini-PC Intel/AMD) aunque tu equipo sea un
# Mac con Apple Silicon: buildx emula, tarda más la primera vez. Cambia con PLATAFORMA=.
set -euo pipefail

RAIZ="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "Ejecuta desde el repositorio." >&2; exit 1; }
cd "$RAIZ"

VERSION=""; CON_DOCKER=0
for arg in "$@"; do
  case "$arg" in
    --con-docker) CON_DOCKER=1 ;;
    *) VERSION="$arg" ;;
  esac
done
VERSION="${VERSION:-$(date +%Y.%m.%d)-$(git rev-parse --short HEAD)}"
PLATAFORMA="${PLATAFORMA:-linux/amd64}"

POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"
REDIS_IMAGE="${REDIS_IMAGE:-redis:7-alpine}"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "! Hay cambios sin confirmar: el paquete no corresponderá a ningún commit." >&2
  [ "${PERMITIR_SUCIO:-0}" = 1 ] || { echo "  Confirma los cambios o usa PERMITIR_SUCIO=1." >&2; exit 1; }
  VERSION="${VERSION}-sucio"
fi

SALIDA="onprem/paquete/pos-dian-$VERSION"
rm -rf "$SALIDA"; mkdir -p "$SALIDA/imagenes" "$SALIDA/nginx" "$SALIDA/scripts"

echo "› Construyendo imágenes $VERSION para $PLATAFORMA…"
docker buildx build --platform "$PLATAFORMA" -f apps/api/Dockerfile --target api -t "pos-dian/api:$VERSION" --load .
docker buildx build --platform "$PLATAFORMA" -f apps/worker/Dockerfile --target worker -t "pos-dian/worker:$VERSION" --load .
docker buildx build --platform "$PLATAFORMA" -f apps/pos-web/Dockerfile --build-arg VITE_API_URL=/api/v1 -t "pos-dian/web:$VERSION" --load .
docker pull --platform "$PLATAFORMA" "$POSTGRES_IMAGE"
docker pull --platform "$PLATAFORMA" "$REDIS_IMAGE"

echo "› Exportando imágenes…"
docker save "pos-dian/api:$VERSION" | gzip -1 > "$SALIDA/imagenes/api.tar.gz"
docker save "pos-dian/worker:$VERSION" | gzip -1 > "$SALIDA/imagenes/worker.tar.gz"
docker save "pos-dian/web:$VERSION" | gzip -1 > "$SALIDA/imagenes/web.tar.gz"
docker save "$POSTGRES_IMAGE" "$REDIS_IMAGE" | gzip -1 > "$SALIDA/imagenes/base.tar.gz"

# Las imágenes base se fijan por digest en el compose del paquete: una actualización nunca
# cambia de Postgres por sorpresa.
PG_REF="$(docker image inspect --format '{{index .RepoDigests 0}}' "$POSTGRES_IMAGE" 2>/dev/null || echo "$POSTGRES_IMAGE")"
RD_REF="$(docker image inspect --format '{{index .RepoDigests 0}}' "$REDIS_IMAGE" 2>/dev/null || echo "$REDIS_IMAGE")"
sed -e "s|\${POSTGRES_IMAGE:-postgres:16-alpine}|${PG_REF}|" -e "s|\${REDIS_IMAGE:-redis:7-alpine}|${RD_REF}|" \
  onprem/docker-compose.onprem.yml > "$SALIDA/docker-compose.yml"

cp onprem/nginx/onprem.conf "$SALIDA/nginx/"
cp onprem/scripts/_comun.sh onprem/scripts/instalar.sh onprem/scripts/certificados.sh onprem/scripts/respaldo.sh \
   onprem/scripts/validar-respaldo.sh onprem/scripts/restaurar.sh onprem/scripts/actualizar.sh \
   onprem/scripts/estado.sh onprem/scripts/configurar-pac.sh onprem/scripts/instalar-licencia.sh onprem/scripts/restablecer-clave.sh "$SALIDA/scripts/"
cp onprem/comercio.env.ejemplo "$SALIDA/"
cp docs/INSTALACION-ONPREM.md "$SALIDA/" 2>/dev/null || true
if [ -f onprem/licencias/publica.pem ]; then
  cp onprem/licencias/publica.pem "$SALIDA/licencia-publica.pem"
else
  echo "! No existe onprem/licencias/publica.pem: el paquete no podrá verificar licencias." >&2
  echo "  Genera el par con: node onprem/licencias/firmar-licencia.mjs generar-llaves" >&2
fi
echo "$VERSION" > "$SALIDA/VERSION"
echo "$PLATAFORMA" > "$SALIDA/PLATAFORMA"
git rev-parse HEAD > "$SALIDA/COMMIT"

if [ "$CON_DOCKER" = 1 ]; then
  ./onprem/scripts/descargar-docker-offline.sh "$SALIDA/docker-debs"
fi

(cd "$SALIDA" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
tar czf "onprem/paquete/pos-dian-$VERSION.tar.gz" -C onprem/paquete "pos-dian-$VERSION"
rm -rf "$SALIDA"

echo "✓ onprem/paquete/pos-dian-$VERSION.tar.gz ($(du -h "onprem/paquete/pos-dian-$VERSION.tar.gz" | cut -f1))"
