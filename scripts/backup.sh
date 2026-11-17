#!/usr/bin/env bash
# Sauvegarde Netflop : base Postgres + volumes de profils Chrome (netflop-profile-*).
#
#   sudo scripts/backup.sh [dossier]          # défaut : /var/backups/netflop
#   KEEP_DAYS=14 sudo scripts/backup.sh       # rotation (14 jours par défaut)
#
# Les profils des navigateurs EN COURS sont sautés (copie incohérente) : relancer la
# sauvegarde la nuit, ou arrêter les séances depuis /admin.
set -euo pipefail
# Les sauvegardes contiennent des jetons OAuth et des cookies de plateformes.
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_ROOT="${1:-/var/backups/netflop}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
DEST="$DEST_ROOT/$STAMP"
mkdir -p "$DEST"
chmod 700 "$DEST_ROOT"
cd "$ROOT"

echo "== Base de données → $DEST/db.dump"
docker compose exec -T db pg_dump -U netflop -d netflop -Fc >"$DEST/db.dump"

echo "== Profils Chrome"
running="$(docker ps --filter label=netflop.managed=true --format '{{.Label "netflop.user"}}')"
for vol in $(docker volume ls -q --filter name=netflop-profile-); do
    [[ "$vol" == netflop-profile-* ]] || continue
    user="${vol#netflop-profile-}"
    if grep -qx "$user" <<<"$running"; then
        echo "  - $vol : navigateur en cours, ignoré"
        continue
    fi
    docker run --rm -v "$vol":/p:ro -v "$DEST":/b alpine:3 \
        tar czf "/b/$vol.tgz" -C /p .
    echo "  - $vol"
done

( cd "$DEST" && sha256sum ./* >SHA256SUMS )
echo "== Rotation (> $KEEP_DAYS jours)"
find "$DEST_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -print -exec rm -rf {} +
echo "Sauvegarde terminée : $DEST"
