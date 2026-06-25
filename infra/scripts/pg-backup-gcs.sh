#!/usr/bin/env bash
# pg-backup-gcs.sh — Backup PostgreSQL con upload a GCS
# Variables requeridas: DATABASE_URL, GCS_BUCKET
# Variables opcionales: PGDATABASE (default: pos_dian), RETENTION_DAYS (default: 30)
set -euo pipefail

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_NAME="${PGDATABASE:-pos_dian}"
BACKUP_FILE="/tmp/${DB_NAME}_${TIMESTAMP}.dump"
GCS_BUCKET="${GCS_BUCKET:-gs://pos-dian-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

echo "[BACKUP] $(date -u +"%Y-%m-%dT%H:%M:%SZ"): Iniciando backup de ${DB_NAME}..."

# Dump en formato custom de pg (comprimido internamente, restaurable con pg_restore)
pg_dump "${DATABASE_URL}" \
  --format=custom \
  --no-password \
  --file="${BACKUP_FILE}"

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[BACKUP] Dump completado. Tamaño: ${BACKUP_SIZE}"

# Upload a GCS
if command -v gsutil &> /dev/null; then
  REMOTE_PATH="${GCS_BUCKET}/postgres/${DB_NAME}_${TIMESTAMP}.dump"
  gsutil cp "${BACKUP_FILE}" "${REMOTE_PATH}"
  echo "[BACKUP] Subido exitosamente: ${REMOTE_PATH}"

  # Eliminar localmente después del upload
  rm -f "${BACKUP_FILE}"

  # Limpiar backups más antiguos que RETENTION_DAYS en GCS
  echo "[BACKUP] Limpiando backups con más de ${RETENTION_DAYS} días..."
  # Calcular fecha de corte compatible con Linux y macOS
  if date -d "-${RETENTION_DAYS} days" &>/dev/null 2>&1; then
    CUTOFF_DATE=$(date -d "-${RETENTION_DAYS} days" +%Y%m%d)
  else
    CUTOFF_DATE=$(date -v-${RETENTION_DAYS}d +%Y%m%d)
  fi

  gsutil ls "${GCS_BUCKET}/postgres/" 2>/dev/null | grep "${DB_NAME}_" | while read -r file; do
    FILE_DATE=$(basename "$file" | grep -oP '\d{8}' | head -1 || true)
    if [[ -n "${FILE_DATE}" && "${FILE_DATE}" < "${CUTOFF_DATE}" ]]; then
      gsutil rm "$file"
      echo "[BACKUP] Eliminado: $file"
    fi
  done
else
  # Fallback: guardar localmente si no hay gsutil disponible
  LOCAL_DIR="${BACKUP_DIR:-/var/backups/pos_dian}"
  mkdir -p "$LOCAL_DIR"
  mv "${BACKUP_FILE}" "${LOCAL_DIR}/"
  find "$LOCAL_DIR" -name "${DB_NAME}_*.dump" -mtime +${RETENTION_DAYS} -delete
  echo "[BACKUP] Sin gsutil disponible. Guardado localmente en: ${LOCAL_DIR}"
fi

echo "[BACKUP] $(date -u +"%Y-%m-%dT%H:%M:%SZ"): Completado exitosamente."
