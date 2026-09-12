#!/usr/bin/env bash
#
# Descarga los .deb de Docker para instalar en un Ubuntu sin internet.
#
#   ./descargar-docker-offline.sh <carpeta-destino> [codename] [arquitectura]
#   (por defecto: noble = Ubuntu 24.04, amd64)
#
# Toma la versión más reciente de cada paquete del repositorio oficial de Docker.
set -euo pipefail
DESTINO="${1:?carpeta destino}"; CODENAME="${2:-noble}"; ARQ="${3:-amd64}"
BASE="https://download.docker.com/linux/ubuntu/dists/${CODENAME}/pool/stable/${ARQ}/"
mkdir -p "$DESTINO"
LISTA="$(curl -fsSL "$BASE")"
for pkg in containerd.io docker-ce-cli docker-ce docker-buildx-plugin docker-compose-plugin; do
  archivo="$(echo "$LISTA" | grep -oE "href=\"${pkg}_[^\"]+_${ARQ}\.deb\"" | sed 's/href="//;s/"$//' | sort -V | tail -1)"
  [ -n "$archivo" ] || { echo "No se encontró $pkg en $BASE" >&2; exit 1; }
  echo "› $archivo"
  curl -fsSL -o "$DESTINO/$archivo" "$BASE$archivo"
done
echo "✓ Docker para Ubuntu $CODENAME/$ARQ en $DESTINO"
