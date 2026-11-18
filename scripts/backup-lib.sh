# shellcheck shell=bash
# Fonctions communes à backup.sh et restore.sh (sourcé, pas exécuté).

# Valeur d'un réglage : variable d'environnement, sinon .env, sinon valeur par défaut.
setting() {
    local key="$1" default="${2:-}" v
    v="${!key:-}"
    if [[ -z "$v" && -f "${ENV_FILE:-}" ]]; then
        v="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
    fi
    echo "${v:-$default}"
}

# Dossiers de sauvegarde à conserver (noms AAAA-MM-JJ_HHMMSS), un par ligne.
#   rotation_keep <keep_daily> <keep_weekly> < liste des dossiers
# Garde les <keep_daily> plus récents, puis le plus récent de chaque semaine ISO
# pour les <keep_weekly> semaines les plus récentes.
rotation_keep() {
    local keep_daily="$1" keep_weekly="$2" i=0 weeks=0 name week
    local -A seen=()
    while read -r name; do
        [[ "$name" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})_[0-9]{6}$ ]] || continue
        week="$(date -d "${BASH_REMATCH[1]}" +%G-%V)"
        if ((i < keep_daily)); then
            echo "$name"
        elif [[ -z "${seen[$week]:-}" ]] && ((weeks < keep_weekly)); then
            echo "$name"
        fi
        if [[ -z "${seen[$week]:-}" ]]; then
            seen[$week]=1
            weeks=$((weeks + 1))
        fi
        i=$((i + 1))
    done < <(sort -r)
}

# Supprime les sauvegardes de <dossier> non retenues par rotation_keep.
rotate() {
    local root="$1" keep_daily="$2" keep_weekly="$3" keep name
    keep="$(find "$root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
        rotation_keep "$keep_daily" "$keep_weekly")"
    while read -r name; do
        [[ "$name" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}$ ]] || continue
        grep -qx "$name" <<<"$keep" && continue
        echo "  - suppression de $name"
        rm -rf "${root:?}/$name"
    done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n')
}
