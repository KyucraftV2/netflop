#!/usr/bin/env bash
# Test de sauvegarde / restauration (CI, ou machine de test JETABLE avec Docker).
# Démarre le service db de docker-compose.yml, y met des données, sauvegarde (chiffrée
# avec age), modifie les données, restaure et vérifie. Teste aussi la rotation.
#
#   scripts/test-backup.sh
#
# ATTENTION : écrase la base et le volume netflop-profile-ci-test du projet Docker courant.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/backup-lib.sh
source scripts/backup-lib.sh
TMP="$(mktemp -d)"
fail() { echo "ÉCHEC : $*" >&2; exit 1; }

echo "== Rotation"
names=""
for d in $(seq 0 59); do
    names+="$(date -d "2026-03-01 + $d days" +%Y-%m-%d)_043000"$'\n'
done
kept="$(printf '%s' "$names" | rotation_keep 7 4 | sort)"
expected="$(printf '%s\n' \
    2026-04-23_043000 2026-04-24_043000 2026-04-25_043000 2026-04-26_043000 \
    2026-04-27_043000 2026-04-28_043000 2026-04-29_043000 \
    2026-04-19_043000 2026-04-12_043000 | sort)"
# Du 1er mars au 29 avril (mercredi) : les 7 derniers jours (23 → 29 avril, sur deux
# semaines ISO), puis le dernier jour des 2 semaines précédentes (dimanches 19 et 12 avril)
# pour couvrir 4 semaines en tout.
[[ "$kept" == "$expected" ]] || fail "rotation inattendue :"$'\n'"$kept"
mkdir -p "$TMP/rot/autre"
while read -r n; do [[ -n "$n" ]] && mkdir "$TMP/rot/$n"; done <<<"$names"
rotate "$TMP/rot" 7 4 >/dev/null
[[ "$(find "$TMP/rot" -mindepth 1 -maxdepth 1 -type d | wc -l)" == 10 ]] ||
    fail "rotate devrait garder 9 sauvegardes + le dossier « autre »"
echo "  OK"

echo "== Préparation"
[[ -f .env ]] || cat >.env <<ENV
HUB_DOMAIN=netflop.example.com
TRAEFIK_NETWORK=netflop-ci-traefik
CERT_RESOLVER=ci
POSTGRES_PASSWORD=ci-$(openssl rand -hex 8)
ENV
docker network inspect netflop-ci-traefik >/dev/null 2>&1 || docker network create netflop-ci-traefik >/dev/null
docker compose up -d --wait db
psql_db() { docker compose exec -T db psql -v ON_ERROR_STOP=1 -qtA -U netflop -d netflop "$@"; }
psql_db -c 'drop schema public cascade; create schema public;' >/dev/null
cat drizzle/*.sql | psql_db >/dev/null
psql_db -c "create table ci_marker (v text); insert into ci_marker values ('avant');"
VOL=netflop-profile-ci-test
docker volume rm -f "$VOL" >/dev/null
docker volume create "$VOL" >/dev/null
docker run --rm -v "$VOL":/p alpine:3 sh -c 'echo avant >/p/cookie'

age-keygen -o "$TMP/key.txt" 2>/dev/null
RECIPIENT="$(age-keygen -y "$TMP/key.txt")"

echo "== Sauvegarde chiffrée"
BACKUP_AGE_RECIPIENT="$RECIPIENT" scripts/backup.sh "$TMP/backups"
DIR="$(find "$TMP/backups" -mindepth 1 -maxdepth 1 -type d | head -n1)"
[[ -f "$DIR/db.dump.age" && -f "$DIR/$VOL.tgz.age" ]] || fail "fichiers chiffrés absents"
[[ ! -e "$DIR/db.dump" ]] || fail "dump en clair laissé sur le disque"

echo "== Modification des données"
psql_db -c "update ci_marker set v = 'apres';"
docker run --rm -v "$VOL":/p alpine:3 sh -c 'echo apres >/p/cookie'

echo "== Restauration"
if scripts/restore.sh "$DIR" --yes --no-start 2>/dev/null; then
    fail "restauration sans clé acceptée"
fi
scripts/restore.sh "$DIR" --identity "$TMP/key.txt" --yes --no-start

[[ "$(psql_db -c 'select v from ci_marker')" == avant ]] || fail "base non restaurée"
[[ "$(docker run --rm -v "$VOL":/p alpine:3 cat /p/cookie)" == avant ]] || fail "profil non restauré"
[[ "$(docker run --rm -v "$VOL":/p alpine:3 stat -c %u /p/cookie)" == 1000 ]] || fail "propriétaire du profil"

docker volume rm -f "$VOL" >/dev/null
rm -rf "$TMP"
echo "Sauvegarde et restauration : OK"
