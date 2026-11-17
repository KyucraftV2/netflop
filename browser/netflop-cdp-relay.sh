#!/bin/sh
# Relais CDP : <IP réseau des navigateurs>:9223 -> 127.0.0.1:9222.
# - n'écoute jamais sur 0.0.0.0 ;
# - n'accepte que le hub et le worker (NETFLOP_CDP_ALLOW, ex. 172.30.250.2/31) :
#   un autre navigateur du même réseau ne peut pas piloter ce Chrome.
set -eu

BIND="${NETFLOP_CDP_BIND:-}"
PORT="${NETFLOP_CDP_PORT:-9223}"
ALLOW="${NETFLOP_CDP_ALLOW:-}"

if [ -z "$BIND" ] || [ -z "$ALLOW" ]; then
    echo "NETFLOP_CDP_BIND ou NETFLOP_CDP_ALLOW absent : relais CDP désactivé"
    exec sleep infinity
fi

i=0
until ip -4 -o addr show | grep -q " ${BIND}/"; do
    i=$((i + 1))
    if [ "$i" -gt 60 ]; then
        echo "IP ${BIND} absente du conteneur : relais CDP non démarré" >&2
        exit 1
    fi
    sleep 1
done

echo "Relais CDP sur ${BIND}:${PORT} (clients autorisés : ${ALLOW})"
exec socat "TCP-LISTEN:${PORT},bind=${BIND},fork,reuseaddr,range=${ALLOW}" TCP:127.0.0.1:9222
