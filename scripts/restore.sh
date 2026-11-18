#!/usr/bin/env bash
# Restauration Netflop depuis un dossier produit par backup.sh.
#
#   sudo scripts/restore.sh <dossier> [--db] [--profiles] [--identity <fichier>] [--yes] [--no-start]
#
#   --db / --profiles   ne restaurer que la base ou que les profils (défaut : les deux)
#   --identity <f>      clé privée age (sauvegarde chiffrée) ; défaut : BACKUP_AGE_IDENTITY
#   --yes               pas de confirmation
#   --no-start          ne pas redémarrer Netflop à la fin
#
# ATTENTION : écrase la base et les profils existants. Les navigateurs sont arrêtés.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
# shellcheck source=scripts/backup-lib.sh
source "$ROOT/scripts/backup-lib.sh"

SRC="${1:?Usage : restore.sh <dossier de sauvegarde> [--db] [--profiles] [--identity <fichier>] [--yes] [--no-start]}"
SRC="$(cd "$SRC" && pwd)"
shift
DO_DB=1
DO_PROFILES=1
ONLY=0
YES=0
START=1
IDENTITY="$(setting BACKUP_AGE_IDENTITY "")"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --db | --profiles)
            if [[ $ONLY == 0 ]]; then DO_DB=0; DO_PROFILES=0; ONLY=1; fi
            [[ "$1" == --db ]] && DO_DB=1 || DO_PROFILES=1
            ;;
        --identity) IDENTITY="${2:?--identity : fichier attendu}"; shift ;;
        --yes) YES=1 ;;
        --no-start) START=0 ;;
        *) echo "Option inconnue : $1" >&2; exit 1 ;;
    esac
    shift
done
cd "$ROOT"
(cd "$SRC" && sha256sum -c SHA256SUMS --quiet)

# Sauvegarde chiffrée : on déchiffre dans un dossier temporaire.
WORK="$SRC"
if compgen -G "$SRC/*.age" >/dev/null; then
    [[ -n "$IDENTITY" ]] || { echo "Sauvegarde chiffrée : --identity <clé age> requis" >&2; exit 1; }
    command -v age >/dev/null || { echo "age n'est pas installé" >&2; exit 1; }
    umask 077
    WORK="$(mktemp -d)"
    trap 'rm -rf "$WORK"' EXIT
    for f in "$SRC"/*.age; do
        age -d -i "$IDENTITY" -o "$WORK/$(basename "$f" .age)" "$f"
    done
    chmod 755 "$WORK"
    chmod 644 "$WORK"/*
fi

if [[ $YES != 1 ]]; then
    read -r -p "Écraser les données actuelles par $SRC ? [o/N] " ans
    [[ "$ans" =~ ^[oOyY]$ ]] || { echo "Annulé."; exit 0; }
fi

echo "== Arrêt du hub, du worker et des navigateurs"
docker compose stop hub worker
for c in $(docker ps -aq --filter label=netflop.managed=true); do docker rm -f "$c" >/dev/null; done

if [[ $DO_DB == 1 ]]; then
    echo "== Base de données"
    docker compose up -d --wait db
    docker compose exec -T db pg_restore -U netflop -d netflop --clean --if-exists --no-owner <"$WORK/db.dump"
    # Les séances de navigateur sauvegardées n'ont plus de conteneur : on les nettoie.
    docker compose exec -T db psql -U netflop -d netflop -c 'delete from browser_session; delete from browser_queue;'
fi

if [[ $DO_PROFILES == 1 ]]; then
    echo "== Profils Chrome"
    for archive in "$WORK"/netflop-profile-*.tgz; do
        [[ -e "$archive" ]] || continue
        vol="$(basename "$archive" .tgz)"
        user="${vol#netflop-profile-}"
        docker volume rm "$vol" >/dev/null 2>&1 || true
        docker volume create --label netflop.managed=true --label "netflop.user=$user" "$vol" >/dev/null
        docker run --rm -v "$vol":/p -v "$WORK":/b:ro alpine:3 sh -c \
            "tar xzf /b/$vol.tgz -C /p && chown -R 1000:1000 /p"
        echo "  - $vol"
    done
fi

if [[ $START == 1 ]]; then docker compose up -d; fi
echo "Restauration terminée."
