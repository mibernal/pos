#!/usr/bin/env bash
#
# Script de Backup Automático de PostgreSQL para el POS DIAN.
# Realiza un volcado (dump) comprimido de la base de datos completa.
#
# Variables de entorno esperadas (o por defecto):
# PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
# BACKUP_DIR: Directorio destino (defecto: ./backups)
# RETENTION_DAYS: Días a retener los backups (defecto: 30)

set -e

# Configuración por defecto
PGHOST=${PGHOST:-"localhost"}
PGPORT=${PGPORT:-"5432"}
PGUSER=${PGUSER:-"pos_user"}
PGDATABASE=${PGDATABASE:-"pos_dian"}
BACKUP_DIR=${BACKUP_DIR:-"/var/backups/pos_dian"}
RETENTION_DAYS=${RETENTION_DAYS:-30}

# Si PGPASSWORD no está configurada, postgres preguntará interactivamente o fallará
# Se asume que en el Cronjob se pasa PGPASSWORD="..."

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/${PGDATABASE}_${TIMESTAMP}.sql.gz"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] INICIO: Generando backup de ${PGDATABASE} en ${PGHOST}:${PGPORT}..."

# Crear directorio si no existe
mkdir -p "$BACKUP_DIR"

# Generar dump comprimido
pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Fc | gzip > "$BACKUP_FILE"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] ÉXITO: Backup guardado en ${BACKUP_FILE}"

# Limpiar backups antiguos
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] INFO: Eliminando backups con más de ${RETENTION_DAYS} días de antigüedad..."
find "$BACKUP_DIR" -type f -name "${PGDATABASE}_*.sql.gz" -mtime +$RETENTION_DAYS -exec rm -f {} \;

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] FIN: Operación de backup completada satisfactoriamente."
