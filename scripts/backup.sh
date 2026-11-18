#!/usr/bin/env bash
# Sauvegarde Netflop : base Postgres + volumes de profils Chrome (netflop-profile-*).
#
#   sudo scripts/backup.sh [dossier]          # défaut : /var/backups/netflop
#
# Réglages (variables d'environnement ou .env) :
#   BACKUP_KEEP_DAILY=7          sauvegardes les plus récentes conservées
#   BACKUP_KEEP_WEEKLY=4         + la plus récente de chacune des N dernières semaines
#   BACKUP_AGE_RECIPIENT=age1…   chiffre chaque fichier avec age (clés séparées par des virgules)
#   BACKUP_RCLONE_REMOTE=…       copie la sauvegarde hors machine (ex. s3:bucket/netflop)
#
# Les profils des navigateurs EN COURS sont sautés (copie incohérente) : lancer la
# sauvegarde la nuit (timer systemd fourni dans scripts/systemd/).
set -euo pipefail
# Les sauvegardes contiennent des jetons OAuth et des cookies de plateformes.
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
# shellcheck source=scripts/backup-lib.sh
source "$ROOT/scripts/backup-lib.sh"

DEST_ROOT="${1:-/var/backups/netflop}"
KEEP_DAILY="$(setting BACKUP_KEEP_DAILY 7)"
KEEP_WEEKLY="$(setting BACKUP_KEEP_WEEKLY 4)"
AGE_RECIPIENT="$(setting BACKUP_AGE_RECIPIENT "")"
RCLONE_REMOTE="$(setting BACKUP_RCLONE_REMOTE "")"
[[ "$KEEP_DAILY" =~ ^[0-9]+$ && "$KEEP_WEEKLY" =~ ^[0-9]+$ ]] || {
    echo "BACKUP_KEEP_DAILY / BACKUP_KEEP_WEEKLY : entier attendu" >&2
    exit 1
}
if [[ -n "$AGE_RECIPIENT" ]] && ! command -v age >/dev/null; then
    echo "BACKUP_AGE_RECIPIENT est défini mais age n'est pas installé" >&2
    exit 1
fi
if [[ -n "$RCLONE_REMOTE" ]] && ! command -v rclone >/dev/null; then
    echo "BACKUP_RCLONE_REMOTE est défini mais rclone n'est pas installé" >&2
    exit 1
fi

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

if [[ -n "$AGE_RECIPIENT" ]]; then
    echo "== Chiffrement (age)"
    recipients=()
    IFS=',' read -r -a keys <<<"$AGE_RECIPIENT"
    for k in "${keys[@]}"; do recipients+=(-r "$k"); done
    for f in "$DEST"/*; do
        age "${recipients[@]}" -o "$f.age" "$f"
        rm -f "$f"
    done
fi

(cd "$DEST" && sha256sum ./* >SHA256SUMS)

if [[ -n "$RCLONE_REMOTE" ]]; then
    echo "== Copie hors machine → $RCLONE_REMOTE/$STAMP"
    rclone copy "$DEST" "$RCLONE_REMOTE/$STAMP"
fi

echo "== Rotation : $KEEP_DAILY dernières + 1 par semaine sur $KEEP_WEEKLY semaines"
rotate "$DEST_ROOT" "$KEEP_DAILY" "$KEEP_WEEKLY"
echo "Sauvegarde terminée : $DEST"
