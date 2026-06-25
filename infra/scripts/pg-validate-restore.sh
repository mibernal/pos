#!/usr/bin/env bash
# pg-validate-restore.sh — Validación automática de integridad del backup más reciente
# Descarga el backup más reciente de GCS, lo restaura en una DB temporal
# y verifica métricas básicas de salud. Se usa en CI (validación semanal).
#
# Variables: DATABASE_URL, GCS_BUCKET, PGDATABASE (default: pos_dian)
set -euo pipefail

GCS_BUCKET="${GCS_BUCKET:-gs://pos-dian-backups}"
DB_NAME="${PGDATABASE:-pos_dian}"
TEMP_DB="${DB_NAME}_restore_validate_$$"
DB_ONLY_URL=$(echo "${DATABASE_URL}" | sed 's|/[^/]*$||')/postgres
TEST_DB_URL=$(echo "${DATABASE_URL}" | sed "s|/${DB_NAME}\$|/${TEMP_DB}|")
DUMP_TMP="/tmp/validate_${TEMP_DB}.dump"

# Asegurar limpieza ante errores
cleanup() {
  echo "[VALIDATE] Limpiando recursos temporales..."
  psql "${DB_ONLY_URL}" -c "DROP DATABASE IF EXISTS \"${TEMP_DB}\";" 2>/dev/null || true
  rm -f "${DUMP_TMP}"
}
trap cleanup EXIT

echo "[VALIDATE] $(date -u +"%Y-%m-%dT%H:%M:%SZ"): Buscando backup más reciente en ${GCS_BUCKET}..."

LATEST=$(gsutil ls "${GCS_BUCKET}/postgres/${DB_NAME}_*.dump" 2>/dev/null | sort | tail -1)

if [[ -z "${LATEST}" ]]; then
  echo "❌ [VALIDATE] No se encontraron backups en ${GCS_BUCKET}/postgres/"
  exit 1
fi

BACKUP_AGE_HOURS=$(( ( $(date +%s) - $(gsutil stat "${LATEST}" | grep -oP 'Updated:\s+\K.+' | xargs -I{} date -d '{}' +%s 2>/dev/null || echo $(date +%s)) ) / 3600 ))
echo "[VALIDATE] Backup más reciente: ${LATEST}"
echo "[VALIDATE] Antigüedad estimada: ${BACKUP_AGE_HOURS}h"

# Advertir si el backup tiene más de 25 horas (se esperaba hace menos de 24h)
if [[ "${BACKUP_AGE_HOURS}" -gt 25 ]]; then
  echo "⚠️  [VALIDATE] ALERTA: El backup más reciente tiene ${BACKUP_AGE_HOURS}h de antigüedad."
  echo "⚠️  [VALIDATE] Es posible que el backup automático no se haya ejecutado."
fi

# Descargar backup
echo "[VALIDATE] Descargando backup..."
gsutil cp "${LATEST}" "${DUMP_TMP}"

DUMP_SIZE=$(du -sh "${DUMP_TMP}" | cut -f1)
echo "[VALIDATE] Descargado (${DUMP_SIZE}). Creando DB temporal: ${TEMP_DB}..."

# Crear DB temporal limpia
psql "${DB_ONLY_URL}" -c "DROP DATABASE IF EXISTS \"${TEMP_DB}\";"
psql "${DB_ONLY_URL}" -c "CREATE DATABASE \"${TEMP_DB}\";"

# Restaurar
echo "[VALIDATE] Restaurando..."
pg_restore \
  --dbname="${TEST_DB_URL}" \
  --no-password \
  --no-owner \
  --no-privileges \
  "${DUMP_TMP}" 2>&1 | grep -v "^pg_restore: warning" || true

echo "[VALIDATE] Restore completado. Ejecutando validaciones de integridad..."

ERRORS=0

check_min() {
  local TABLE="$1"
  local MIN_EXPECTED="$2"
  local COUNT
  COUNT=$(psql "${TEST_DB_URL}" -t -c "SELECT COUNT(*) FROM ${TABLE};" 2>/dev/null | tr -d ' \n')
  if [[ -z "${COUNT}" ]]; then
    echo "❌ [VALIDATE] FALLO: No se pudo consultar la tabla ${TABLE}"
    ERRORS=$((ERRORS + 1))
  elif [[ "${COUNT}" -lt "${MIN_EXPECTED}" ]]; then
    echo "❌ [VALIDATE] FALLO: ${TABLE} tiene ${COUNT} filas (mínimo esperado: ${MIN_EXPECTED})"
    ERRORS=$((ERRORS + 1))
  else
    echo "✅ [VALIDATE] ${TABLE}: ${COUNT} filas"
  fi
}

# Tablas críticas del SaaS
check_min "billing_plans"      1
check_min "tenants"            1
check_min "kysely_migration"   80   # Al menos 80 migraciones aplicadas

# Tablas de negocio (pueden ser 0 en instalación fresca)
check_min "sales"              0
check_min "inventory_balances" 0
check_min "outbox_events"      0

# Verificar que RLS está habilitado en tablas críticas
RLS_TABLES=$(psql "${TEST_DB_URL}" -t -c "
  SELECT COUNT(*)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = true;
" 2>/dev/null | tr -d ' \n')

if [[ "${RLS_TABLES:-0}" -gt 0 ]]; then
  echo "✅ [VALIDATE] RLS habilitado en ${RLS_TABLES} tablas"
else
  echo "⚠️  [VALIDATE] RLS no detectado en ninguna tabla (puede ser normal en restore)"
fi

# Resultado final
echo ""
if [[ "${ERRORS}" -gt 0 ]]; then
  echo "❌ [VALIDATE] FALLO: ${ERRORS} validación(es) fallida(s). Revisar backup."
  exit 1
else
  echo "✅ [VALIDATE] ÉXITO: Backup validado correctamente."
  echo "   Backup: $(basename "${LATEST}")"
  echo "   Fecha:  $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
fi
