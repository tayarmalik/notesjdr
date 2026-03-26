#!/bin/bash
# Backup .env et BDD
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/jdrnotes/backups"
cp /opt/jdrnotes/.env "$BACKUP_DIR/.env_$DATE"
# Garder 30 derniers backups .env
ls -t "$BACKUP_DIR"/.env_* 2>/dev/null | tail -n +31 | xargs rm -f
echo "Backup .env OK: $DATE"
