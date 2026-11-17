#!/usr/bin/env bash
# Pare-feu Netflop.
#
#   sudo scripts/firewall.sh              # état : ports publiés par Docker + règles ufw
#   sudo scripts/firewall.sh --ufw        # ouvre les ports des slots dans ufw (UDP + TCP)
#   sudo scripts/firewall.sh --docker-user [--yes]
#        # n'autorise, pour les ports PUBLIÉS PAR DOCKER, que 80/443 + ports des slots
#        # (+ EXTRA_PUBLIC_PORTS) ; bloque tout autre port publié par un conteneur.
#
# ATTENTION : Docker écrit ses propres règles iptables AVANT celles d'ufw. Une règle
# ufw ne bloque donc PAS un port publié par un conteneur. Seule la chaîne DOCKER-USER
# le permet (option --docker-user). Les règles iptables ne survivent pas à un
# redémarrage : voir README (unité systemd netflop-firewall).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
CHAIN="NETFLOP-PUBLISHED"

env_value() {
    local key="$1" default="${2:-}"
    local v
    v="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
    echo "${v:-$default}"
}

SLOT_PORTS="$(env_value SLOT_PORTS 52000,52001,52002)"
EXTRA_PUBLIC_PORTS="${EXTRA_PUBLIC_PORTS:-$(env_value EXTRA_PUBLIC_PORTS "")}"
IFS=',' read -r -a PORTS <<<"$SLOT_PORTS"
for p in "${PORTS[@]}"; do
    [[ "$p" =~ ^[0-9]+$ ]] || { echo "Port de slot invalide : $p" >&2; exit 1; }
done

ext_if() { ip -4 route get 1.1.1.1 | awk '{for (i=1;i<NF;i++) if ($i=="dev") print $(i+1)}'; }

status() {
    echo "== Ports publiés par Docker sur l'hôte"
    docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '0\.0\.0\.0|\[::\]' || echo "(aucun)"
    echo
    echo "== Règles ufw"
    ufw status numbered 2>/dev/null || echo "(ufw indisponible)"
    echo
    echo "== Chaîne DOCKER-USER"
    iptables -S DOCKER-USER 2>/dev/null || echo "(absente)"
    iptables -S "$CHAIN" 2>/dev/null || true
    echo
    echo "Test depuis TA machine (pas le VPS) :"
    echo "  sudo nmap -sU -p ${SLOT_PORTS} <PUBLIC_IP>     # open|filtered attendu quand un navigateur tourne"
    echo "  nmap -Pn -p 5432,2375,9222,9223 <PUBLIC_IP>    # tous doivent être filtered/closed"
}

apply_ufw() {
    for p in "${PORTS[@]}"; do
        ufw allow "${p}/udp" comment "netflop webrtc"
        ufw allow "${p}/tcp" comment "netflop webrtc (tcp fallback)"
    done
    ufw status | grep -E "$(IFS='|'; echo "${PORTS[*]}")" || true
}

apply_docker_user() {
    local yes="${1:-}"
    local iface allowed=(80 443 "${PORTS[@]}")
    iface="$(ext_if)"
    if [[ -n "$EXTRA_PUBLIC_PORTS" ]]; then
        IFS=',' read -r -a extra <<<"$EXTRA_PUBLIC_PORTS"
        allowed+=("${extra[@]}")
    fi

    echo "Interface externe : $iface"
    echo "Ports publiés autorisés depuis Internet : ${allowed[*]}"
    echo "Tout AUTRE port publié par un conteneur sera bloqué depuis Internet."
    echo "Ports actuellement publiés :"
    docker ps --format '  {{.Names}}\t{{.Ports}}' | grep -E '0\.0\.0\.0|\[::\]' || echo "  (aucun)"
    if [[ "$yes" != "--yes" ]]; then
        read -r -p "Continuer ? [o/N] " ans
        [[ "$ans" =~ ^[oOyY]$ ]] || { echo "Annulé."; exit 0; }
    fi

    iptables -N "$CHAIN" 2>/dev/null || iptables -F "$CHAIN"
    for p in "${allowed[@]}"; do
        [[ "$p" =~ ^[0-9]+$ ]] || { echo "Port invalide : $p" >&2; exit 1; }
        iptables -A "$CHAIN" -p udp -m conntrack --ctorigdstport "$p" -j RETURN
        iptables -A "$CHAIN" -p tcp -m conntrack --ctorigdstport "$p" -j RETURN
    done
    iptables -A "$CHAIN" -j DROP

    local rule=(-i "$iface" -m conntrack --ctstate NEW -j "$CHAIN")
    iptables -C DOCKER-USER "${rule[@]}" 2>/dev/null || iptables -I DOCKER-USER 1 "${rule[@]}"
    echo "Règles DOCKER-USER appliquées."
    iptables -S "$CHAIN"
}

case "${1:-}" in
    "") status ;;
    --ufw) apply_ufw ;;
    --docker-user) apply_docker_user "${2:-}" ;;
    *) sed -n '2,13p' "$0"; exit 1 ;;
esac
