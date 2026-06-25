#!/usr/bin/env bash
# pg-restore.sh — Restore de PostgreSQL desde dump (archivo local o ruta gs://)
# Uso: ./pg-restore.sh <archivo.dump | gs://ruta> [--confirm]
# Variables: DATABASE_URL (apunta a la DB destino)
set -euo pipefail

DUMP_INPUT="${1:-}"
CONFIRM="${2:-}"

if [[ -z "${DUMP_INPUT}" ]]; then
  echo ""
  echo "Uso: $0 <archivo.dump | gs://bucket/path/file.dump> [--confirm]"
  echo ""
  echo "Ejemplos:"
  echo "  $0 /tmp/pos_dian_20260625_020000.dump --confirm"
  echo "  $0 gs://pos-dian-backups/postgres/pos_dian_20260625_020000.dump"
  echo ""
  exit 1
fi

DUMP_FILE="${DUMP_INPUT}"

# Si viene desde GCS, descargarlo primero
if [[ "${DUMP_INPUT}" == gs://* ]]; then
  echo "[RESTORE] Descargando desde GCS: ${DUMP_INPUT}..."
  gsutil cp "${DUMP_INPUT}" /tmp/restore_download.dump
  DUMP_FILE="/tmp/restore_download.dump"
fi

if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "❌ Archivo no encontrado: ${DUMP_FILE}"
  exit 1
fi

TARGET_DB_URL="${DATABASE_URL}"
DB_NAME=$(echo "$TARGET_DB_URL" | grep -oP '[^/]+$')
DB_ONLY_URL=$(echo "$TARGET_DB_URL" | sed 's|/[^/]*$||')/postgres

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  ⚠️  ADVERTENCIA: OPERACIÓN DESTRUCTIVA"
echo "══════════════════════════════════════════════════════════"
echo "  Base de datos destino : ${DB_NAME}"
echo "  Archivo a restaurar   : $(basename "${DUMP_FILE}")"
echo "  Todos los datos actuales serán ELIMINADOS."
echo "══════════════════════════════════════════════════════════"
echo ""

if [[ "${CONFIRM}" != "--confirm" ]]; then
  read -r -p "  Escribe 'CONFIRMAR' para proceder: " USER_INPUT
  if [[ "${USER_INPUT}" != "CONFIRMAR" ]]; then
    echo "❌ Operación cancelada."
    exit 1
  fi
fi

echo ""
echo "[RESTORE] $(date -u +"%Y-%m-%dT%H:%M:%SZ"): Iniciando restore..."

# Terminar conexiones activas a la DB destino
echo "[RESTORE] Terminando conexiones activas..."
psql "${DB_ONLY_URL}" -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();
" 2>/dev/null || true

# Drop y recrear la base de datos para garantizar estado limpio
echo "[RESTORE] Recreando base de datos ${DB_NAME}..."
psql "${DB_ONLY_URL}" -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";"
psql "${DB_ONLY_URL}" -c "CREATE DATABASE \"${DB_NAME}\";"

# Restore desde formato custom de pg_dump
echo "[RESTORE] Restaurando datos..."
pg_restore \
  --dbname="${TARGET_DB_URL}" \
  --no-password \
  --no-owner \
  --no-privileges \
  "${DUMP_FILE}"

# Limpiar archivo temporal de GCS si fue descargado
if [[ "${DUMP_INPUT}" == gs://* ]]; then
  rm -f /tmp/restore_download.dump
fi

echo ""
echo "[RESTORE] $(date -u +"%Y-%m-%dT%H:%M:%SZ"): ✅ Restore completado exitosamente."
echo ""
echo "Valida la integridad con:"
echo "  psql \"\${DATABASE_URL}\" -c \"SELECT COUNT(*) FROM tenants;\""
echo "  psql \"\${DATABASE_URL}\" -c \"SELECT COUNT(*) FROM sales;\""
echo "  psql \"\${DATABASE_URL}\" -c \"SELECT COUNT(*) FROM billing_plans;\""
echo ""
