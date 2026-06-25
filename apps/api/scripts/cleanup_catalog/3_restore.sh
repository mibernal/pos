#!/bin/bash
# Script para Restaurar la Base de Datos en caso de error
# Uso: ./3_restore.sh <nombre_del_archivo_de_backup.sql>

if [ -z "$1" ]; then
  echo "Uso: $0 <archivo_de_backup.sql>"
  exit 1
fi

BACKUP_FILE=$1
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USER:-pos}
DB_NAME=${DB_NAME:-pos_dian}

echo "Iniciando restauración desde $BACKUP_FILE..."
export PGPASSWORD=${DB_PASSWORD:-pos}

# Se asume que la base de datos ya existe, por lo que usamos clean (--clean) para borrar objetos antes de crear
pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --clean --if-exists "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  echo "✅ Restauración completada con éxito."
else
  echo "❌ Error durante la restauración."
  exit 1
fi
