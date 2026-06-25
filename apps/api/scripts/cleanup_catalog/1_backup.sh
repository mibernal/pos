#!/bin/bash
# Script de Respaldo de Seguridad antes de Limpieza de Maestros
# Este script asume que las variables de entorno de PostgreSQL están configuradas
# o utiliza las credenciales por defecto de Docker.

DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USER:-pos}
DB_NAME=${DB_NAME:-pos_dian}
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="backup_pos_dian_pre_cleanup_${TIMESTAMP}.sql"

echo "Iniciando respaldo de base de datos..."
echo "Host: $DB_HOST | BD: $DB_NAME | Usuario: $DB_USER"

# Evitar pedir contraseña si usamos PGPASSWORD
export PGPASSWORD=${DB_PASSWORD:-pos}

pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -F c -f "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  echo "✅ Respaldo exitoso: $BACKUP_FILE"
else
  echo "❌ Error al crear el respaldo."
  exit 1
fi
