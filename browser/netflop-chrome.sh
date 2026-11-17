#!/bin/sh
# Lance Google Chrome avec le profil persistant Netflop.
set -eu

PROFILE=/home/neko/chrome-profile

# Un conteneur supprimé brutalement laisse des verrous et un état « planté »
# qui afficherait la bulle « Restaurer les pages ? » au démarrage suivant.
rm -f "$PROFILE"/SingletonLock "$PROFILE"/SingletonSocket "$PROFILE"/SingletonCookie
if [ -f "$PROFILE/Default/Preferences" ]; then
    sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' \
        "$PROFILE/Default/Preferences" || true
fi

# Le port CDP n'écoute QUE sur 127.0.0.1 ; netflop-cdp-relay l'expose sur l'IP
# du réseau interne uniquement. Il n'est jamais publié ni routé par Traefik.
exec /usr/bin/google-chrome \
    --no-sandbox \
    --window-position=0,0 \
    --display="${DISPLAY}" \
    --user-data-dir="$PROFILE" \
    --no-first-run \
    --no-default-browser-check \
    --start-maximized \
    --disable-file-system \
    --disable-gpu \
    --disable-software-rasterizer \
    --password-store=basic \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port=9222
