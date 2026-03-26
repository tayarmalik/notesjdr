#!/bin/bash
WEBHOOK_URL="https://discord.com/api/webhooks/1483342462700490813/XjrZ8CqL-NXzpv6j161jGzScs_P9Gmjluc84oo0aRJfnDGjTr7Jqx05TPrM1EBm1ulk9"
SERVICES=("vaultlog" "botcraig")
for SERVICE in "${SERVICES[@]}"; do
    if ! systemctl is-active --quiet "$SERVICE"; then
        MSG="🚨 **Alerte serveur JDR** : Le service \`$SERVICE\` est arrêté sur \`jdr\` ! $(date '+%d/%m/%Y %H:%M')"
        curl -s -X POST "$WEBHOOK_URL" \
            -H "Content-Type: application/json" \
            -d "{\"content\": \"$MSG\"}" > /dev/null
        # Tentative de redémarrage
        systemctl restart "$SERVICE"
        sleep 5
        if systemctl is-active --quiet "$SERVICE"; then
            curl -s -X POST "$WEBHOOK_URL" \
                -H "Content-Type: application/json" \
                -d "{\"content\": \"✅ Service \`$SERVICE\` redémarré automatiquement.\"}" > /dev/null
        fi
    fi
done

# Alerte espace disque faible (< 10 Go)
DISK_FREE=$(df /opt/vaultlog --output=avail -BG | tail -1 | tr -d 'G ')
if [ "$DISK_FREE" -lt 10 ]; then
    curl -s -X POST "$WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "{\"content\": \"⚠️ **Alerte disque** : Seulement ${DISK_FREE}Go disponibles sur \`jdr\` ! $(date '+%d/%m/%Y %H:%M')\"}" > /dev/null
fi
