#!/bin/bash
# ===========================================
# SeitoCamera Admin — Backup automàtic PostgreSQL
# ===========================================
# Ús: ./scripts/backup.sh
# Cron recomanat: 0 3 * * * /ruta/al/projecte/scripts/backup.sh
# ===========================================

set -euo pipefail

# Directori del projecte (un nivell amunt del script)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Carregar variables d'entorn
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

# Configuració
BACKUP_DIR="$PROJECT_DIR/backups"
DB_CONTAINER="seitocamera-db"
DB_USER="${DB_USER:-seitocamera}"
DB_NAME="${DB_NAME:-seitocamera_admin}"
DATE=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)  # 1=dilluns, 7=diumenge

# Colors per output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[BACKUP]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"; }
error() { echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"; }

# Crear directoris si no existeixen
mkdir -p "$BACKUP_DIR/daily"
mkdir -p "$BACKUP_DIR/weekly"

log "Iniciant backup de la base de dades..."

# ===========================================
# 1. Backup diari (comprimut amb gzip)
# ===========================================
DAILY_FILE="$BACKUP_DIR/daily/${DB_NAME}_${DATE}.sql.gz"

if docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$DAILY_FILE"; then
    SIZE=$(du -h "$DAILY_FILE" | cut -f1)
    log "Backup diari creat: $DAILY_FILE ($SIZE)"
else
    error "Error creant backup diari!"
    exit 1
fi

# ===========================================
# 2. Backup setmanal (cada diumenge)
# ===========================================
if [ "$DAY_OF_WEEK" -eq 7 ]; then
    WEEKLY_FILE="$BACKUP_DIR/weekly/${DB_NAME}_week_${DATE}.sql.gz"
    cp "$DAILY_FILE" "$WEEKLY_FILE"
    log "Backup setmanal creat: $WEEKLY_FILE"
fi

# ===========================================
# 3. Rotació — eliminar backups antics
# ===========================================
# Diaris: mantenir últims 7 dies
DELETED_DAILY=$(find "$BACKUP_DIR/daily" -name "*.sql.gz" -mtime +7 -delete -print | wc -l)
if [ "$DELETED_DAILY" -gt 0 ]; then
    log "Eliminats $DELETED_DAILY backups diaris antics (>7 dies)"
fi

# Setmanals: mantenir últimes 4 setmanes
DELETED_WEEKLY=$(find "$BACKUP_DIR/weekly" -name "*.sql.gz" -mtime +28 -delete -print | wc -l)
if [ "$DELETED_WEEKLY" -gt 0 ]; then
    log "Eliminats $DELETED_WEEKLY backups setmanals antics (>28 dies)"
fi

# ===========================================
# 4. Resum
# ===========================================
TOTAL_DAILY=$(find "$BACKUP_DIR/daily" -name "*.sql.gz" | wc -l)
TOTAL_WEEKLY=$(find "$BACKUP_DIR/weekly" -name "*.sql.gz" | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)

log "=== Resum ==="
log "Backups diaris: $TOTAL_DAILY"
log "Backups setmanals: $TOTAL_WEEKLY"
log "Espai total: $TOTAL_SIZE"
log "Backup completat correctament!"
