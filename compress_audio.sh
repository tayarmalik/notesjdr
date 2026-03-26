#!/bin/bash
# Compresser les fichiers audio de plus de 7 jours
AUDIO_DIR="/opt/jdrnotes/audio"
find "$AUDIO_DIR" -name "*.wav" -mtime +7 -exec gzip -9 {} \; -exec echo "Compressé: {}" \;
find "$AUDIO_DIR" -name "*.mp3" -mtime +7 -exec gzip -9 {} \; -exec echo "Compressé: {}" \;
# Supprimer les ZIPs expirés de plus de 7 jours
find "$AUDIO_DIR" -name "*.zip" -mtime +7 -exec rm -f {} \; -exec echo "Supprimé: {}" \;
echo "Compression audio terminée: $(date)"
