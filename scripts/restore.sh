#!/usr/bin/env bash
# Restauration Netflop depuis un dossier produit par backup.sh.
#
#   sudo scripts/restore.sh /var/backups/netflop/2026-11-17_030000 [--db] [--profiles]
#   (sans option : base ET profils)
#
# ATTENTION : écrase la base et les profils existants. Les navigateurs sont arrêtés.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:?Usage : restore.sh <dossier de sauvegarde> [--db] [--profiles]}"
shift
DO_DB=1
DO_PROFILES=1
if [[ $# -gt 0 ]]; then
    DO_DB=0
    DO_PROFILES=0
    for a in "$@"; do
        case "$a" in
            --db) DO_DB=1 ;;
            --profiles) DO_PROFILES=1 ;;
            *) echo "Option inconnue : $a" >&2; exit 1 ;;
        esac
    done
fi
cd "$ROOT"
( cd "$SRC" && sha256sum -c SHA256SUMS --quiet )

read -r -p "Écraser les données actuelles par $SRC ? [o/N] " ans
[[ "$ans" =~ ^[oOyY]$ ]] || { echo "Annulé."; exit 0; }

echo "== Arrêt du hub, du worker et des navigateurs"
docker compose stop hub worker
for c in $(docker ps -aq --filter label=netflop.managed=true); do docker rm -f "$c" >/dev/null; done

if [[ $DO_DB == 1 ]]; then
    echo "== Base de données"
    docker compose up -d db
    docker compose exec -T db pg_restore -U netflop -d netflop --clean --if-exists --no-owner <"$SRC/db.dump"
    # Les séances de navigateur sauvegardées n'ont plus de conteneur : on les nettoie.
    docker compose exec -T db psql -U netflop -d netflop -c 'delete from browser_session; delete from browser_queue;'
fi

if [[ $DO_PROFILES == 1 ]]; then
    echo "== Profils Chrome"
    for archive in "$SRC"/netflop-profile-*.tgz; do
        [[ -e "$archive" ]] || continue
        vol="$(basename "$archive" .tgz)"
        user="${vol#netflop-profile-}"
        docker volume rm "$vol" >/dev/null 2>&1 || true
        docker volume create --label netflop.managed=true --label "netflop.user=$user" "$vol" >/dev/null
        docker run --rm -v "$vol":/p -v "$SRC":/b:ro alpine:3 sh -c \
            "tar xzf /b/$vol.tgz -C /p && chown -R 1000:1000 /p"
        echo "  - $vol"
    done
fi

docker compose up -d
echo "Restauration terminée."
