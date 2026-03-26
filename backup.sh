#!/bin/bash
BACKUP_DIR="/opt/jdrnotes/backups"
DB="/opt/jdrnotes/data/volog.db"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"
cp "$DB" "$BACKUP_DIR/volog_$DATE.db"
# Garder seulement les 30 derniers backups
ls -t "$BACKUP_DIR"/volog_*.db | tail -n +31 | xargs rm -f
echo "Backup créé : volog_$DATE.db"
