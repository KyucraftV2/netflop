# Image netflop-browser : Neko + Google Chrome (Widevine inclus) + politiques Netflop.
# Construite par : docker compose --profile build build browser-image
ARG NEKO_VERSION=3.2.0
FROM ghcr.io/m1k1o/neko/google-chrome:${NEKO_VERSION}

# 1 = liste blanche d'URL (Netflix, Canal+, france.tv, CDN, pages de connexion) :
# le navigateur ne peut servir à rien d'autre. Désactivée par défaut : un domaine
# manquant (CDN, captcha) peut bloquer une lecture ; à activer après tests.
ARG NETFLOP_URL_ALLOWLIST=0

# socat : relais CDP ; iproute2 : attente de l'IP interne avant d'écouter.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends socat iproute2; \
    apt-get clean -y; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# Remplace la configuration supervisord de l'image d'origine (on retire notamment
# --bwsi, le mode invité qui empêcherait toute persistance du profil).
COPY supervisord.conf /etc/neko/supervisord/google-chrome.conf
COPY netflop-chrome.sh /usr/local/bin/netflop-chrome
COPY netflop-cdp-relay.sh /usr/local/bin/netflop-cdp-relay
COPY policies.json /etc/opt/chrome/policies/managed/policies.json
COPY policies-allowlist.json /opt/netflop/policies-allowlist.json
COPY home/ /opt/netflop/home/

# Profil hors du répertoire par défaut (Chrome >= 136 refuse le CDP sur le profil par défaut).
# Le contenu de ce dossier initialise le volume nommé à sa première création.
RUN set -eux; \
    chmod 0755 /usr/local/bin/netflop-chrome /usr/local/bin/netflop-cdp-relay; \
    install -d -o neko -g neko -m 0700 /home/neko/chrome-profile; \
    if [ -d /home/neko/.config/google-chrome/Default ]; then \
        cp -a /home/neko/.config/google-chrome/Default /home/neko/chrome-profile/; \
        chown -R neko:neko /home/neko/chrome-profile; \
    fi; \
    if [ "${NETFLOP_URL_ALLOWLIST}" = "1" ]; then \
        cp /opt/netflop/policies-allowlist.json /etc/opt/chrome/policies/managed/allowlist.json; \
    fi; \
    chmod -R a+rX /opt/netflop
