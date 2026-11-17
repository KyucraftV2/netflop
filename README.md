# Netflop

Hub de streaming self-hosted à usage privé. Netflix, Canal+ (qui inclut HBO Max et
Apple TV+) et france.tv ne peuvent être ni intégrés en iframe ni passés par un
reverse proxy. Chaque utilisateur reçoit donc **son propre Chrome distant**
([Neko](https://github.com/m1k1o/neko), streamé en WebRTC), affiché dans le hub. Ce
navigateur est créé quand l'utilisateur lance une lecture et supprimé quand il quitte.
Son profil Chrome est conservé entre les séances.

> **Avertissement** : projet personnel, non affilié à Netflix, Canal+, HBO Max, Apple ou
> France Télévisions, ni à TMDB ou JustWatch. Chaque utilisateur se connecte avec **ses
> propres abonnements**. Respecte les conditions d'utilisation de chaque plateforme
> (notamment sur le partage de compte et le nombre d'écrans). Les noms et logos des
> plateformes appartiennent à leurs propriétaires respectifs.

## Architecture

```
Internet ──443──> Traefik ──(réseau Traefik)──> hub (Next.js)
            │        └──(netflop-browsers)──/b/<user>/──> neko-<user>  (forwardAuth → hub)
            └─UDP/TCP 52000-52002 ──────────────────────> neko-<user>  (WebRTC)

netflop-browsers  : Traefik, hub (.2), worker (.3), neko-<user> (.10+slot)   ← CDP :9223 réservé à .2/.3
netflop-internal  : hub, worker, migrate, db, docker-proxy (internal, sans Internet)
docker-proxy ── /var/run/docker.sock (lecture seule, seul montage du socket)
```

| Service        | Rôle                                                                  | Réseaux           |
| -------------- | --------------------------------------------------------------------- | ----------------- |
| `hub`          | Next.js, routes `/api/*`, forwardAuth `/api/browser-auth`             | Traefik + interne |
| `worker`       | Cycle de vie des navigateurs + suivi de visionnage (`node worker.js`) | interne           |
| `migrate`      | Applique les migrations SQL (`drizzle/`) puis s'arrête                | interne           |
| `db`           | Postgres 16                                                           | interne           |
| `docker-proxy` | API Docker filtrée (conteneurs, réseaux, volumes)                     | interne           |
| `neko-<user>`  | Créé à la demande, jamais dans le compose                             | Traefik + interne |

Chaque navigateur a la configuration suivante :

- **Image** : `netflop-browser`, construite depuis `browser/`.
- **Ressources** : 1,5 Go de RAM, 1,5 CPU et 2 Go de `/dev/shm`.
- **WebRTC** : un port par slot, en UDP avec un repli TCP.
- **IP interne fixe** : `172.30.250.(10 + slot)`.
- **Profil** : volume `netflop-profile-<user>` monté sur `/home/neko/chrome-profile`.
- **Routage** : Neko est servi directement sous `/b/<user>/` (`NEKO_SERVER_PATH_PREFIX`), sans StripPrefix.

## Installation

Netflop s'installe sur n'importe quelle machine Linux qui fait tourner Docker et qui est
joignable depuis Internet : serveur dédié, VPS, mini-PC ou NAS à la maison, machine
virtuelle…

### Prérequis

| Élément        | Détail                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Machine        | Linux **x86_64 ou arm64** (Google Chrome n'existe pas pour les autres architectures)                                                      |
| Mémoire        | Environ **1,5 Go par navigateur simultané**, plus environ 1 Go pour le reste (hub, worker, base). Avec 3 navigateurs, prévois 6 Go libres |
| Docker         | Docker Engine ≥ 25 (API 1.44) avec le plugin Compose                                                                                      |
| Reverse proxy  | Traefik v2 ou v3 avec le provider Docker. Il doit s'appeler `docker`, car les middlewares sont référencés en `@docker`                    |
| HTTPS          | Un résolveur de certificats dans Traefik (Let's Encrypt, par exemple)                                                                     |
| Nom de domaine | Un enregistrement DNS (ex. `netflop.example.com`) qui pointe vers la machine                                                              |
| Identité       | Un serveur Authentik (voir [Configuration Authentik](#configuration-authentik))                                                           |
| Réseau         | Une IPv4 publique joignable sur les ports WebRTC (UDP, plus TCP en secours), un par navigateur simultané                                  |
| Catalogue      | Une clé d'API [TMDB](https://www.themoviedb.org/settings/api), gratuite                                                                   |

Derrière une box (NAT) : `PUBLIC_IP` est l'IP publique de la box. Redirige vers la machine
les ports 80 et 443 (Traefik) ainsi que les ports WebRTC (`SLOT_PORTS`), en UDP et en TCP.

### 1. Récupérer le code

```bash
git clone https://github.com/KyucraftV2/netflop.git
cd netflop
```

### 2. Configurer

```bash
cp .env.example .env && chmod 600 .env
```

Remplis toutes les valeurs `<...>` du fichier `.env` (chaque variable y est commentée).
Les principales :

| Variable                              | Comment l'obtenir                                                    |
| ------------------------------------- | -------------------------------------------------------------------- |
| `HUB_DOMAIN`, `AUTH_URL`              | Ton nom de domaine (`AUTH_URL=https://<HUB_DOMAIN>`)                 |
| `TRAEFIK_NETWORK`                     | Le réseau Docker de Traefik : `docker network ls`                    |
| `TRAEFIK_ENTRYPOINT`, `CERT_RESOLVER` | Les noms définis dans la configuration statique de Traefik           |
| `PUBLIC_IP`                           | L'IPv4 publique de la machine (ou de la box) : `curl -4 ifconfig.me` |
| `AUTHENTIK_URL`, `AUTH_AUTHENTIK_*`   | Voir [Configuration Authentik](#configuration-authentik)             |
| `POSTGRES_PASSWORD`                   | `openssl rand -hex 24`                                               |
| `AUTH_SECRET`                         | `openssl rand -base64 33`                                            |
| `TMDB_API_KEY`                        | La clé ou le jeton v4 de ton compte TMDB                             |

### 3. Construire l'image des navigateurs

```bash
docker compose --profile build build browser-image   # Neko + Chrome, environ 2 Go
```

### 4. Démarrer

```bash
docker compose up -d --build
docker compose ps               # hub et db « healthy », worker et docker-proxy « running »
docker compose logs migrate     # « migrations appliquées »
```

### 5. Raccorder Traefik au réseau des navigateurs

Traefik joint les navigateurs (`/b/<user>/`) par le réseau dédié `netflop-browsers`, créé à
l'étape 4 :

```bash
docker network connect netflop-browsers <conteneur traefik>
```

Pour que ce raccordement survive à un redémarrage de Traefik, déclare aussi
`netflop-browsers` comme réseau externe dans la configuration de Traefik.

### 6. Ouvrir les ports WebRTC

Les ports `SLOT_PORTS` (52000 à 52002 par défaut) doivent être joignables depuis Internet,
en UDP et en TCP :

- **avec ufw** : `sudo scripts/firewall.sh --ufw`, puis `sudo scripts/firewall.sh` pour
  afficher l'état et les commandes de test ;
- **avec un autre pare-feu**, un pare-feu d'hébergeur ou une box : ouvre ou redirige ces
  ports à la main.

### 7. Vérifier

- `https://<HUB_DOMAIN>` affiche la page de connexion.
- Après connexion, lancer une plateforme démarre un navigateur en quelques secondes
  (`docker ps --filter label=netflop.managed=true`).
- Sans session, `curl -sI https://<HUB_DOMAIN>/b/<slug>/` répond `401` (et non `404`).

En cas de souci, voir [Dépannage](#dépannage) et [Diagnostic d'un navigateur](#diagnostic-dun-navigateur).

### Pare-feu : ufw ne protège pas les ports publiés par Docker

Docker insère ses règles iptables **avant** celles d'ufw. Un port publié par un conteneur
est donc joignable depuis Internet même si ufw le « refuse ». Netflop ne publie que les
ports des slots ; Postgres, docker-proxy et le CDP ne le sont jamais.

Pour verrouiller tous les ports publiés par Docker sur la machine, il existe une option
facultative :

```bash
sudo EXTRA_PUBLIC_PORTS=8448 scripts/firewall.sh --docker-user
```

Elle n'autorise que les ports 80 et 443, les ports des slots et `EXTRA_PUBLIC_PORTS`.
Tout autre port publié par un conteneur est bloqué. **Vérifie bien la liste qu'elle
affiche avant de confirmer.** Ces règles ne survivent pas à un redémarrage. Pour les
rendre persistantes :

```ini
# /etc/systemd/system/netflop-firewall.service
[Unit]
Description=Netflop DOCKER-USER rules
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/chemin/vers/netflop/scripts/firewall.sh --docker-user --yes

[Install]
WantedBy=multi-user.target
```

`sudo systemctl daemon-reload && sudo systemctl enable --now netflop-firewall`

## Configuration Authentik

Ces étapes se font dans l'interface d'administration d'Authentik.

1. **Groupes** (_Directory → Groups → Create_)
   - Crée les groupes `netflop` et `netflop-admins`.
   - Ajoute ton compte dans les deux (_onglet Users → Add existing user_).
2. **Provider** (_Applications → Providers → Create → OAuth2/OpenID Provider_)
   - Nom : `netflop`
   - Authorization flow : `default-provider-authorization-implicit-consent`
   - Client type : **Confidential**. Note le _Client ID_ et le _Client Secret_ : ils vont dans `AUTH_AUTHENTIK_ID` et `AUTH_AUTHENTIK_SECRET`.
   - Redirect URIs : `Strict` → `https://netflop.example.com/api/auth/callback/authentik`
   - Signing key : `authentik Self-signed Certificate`
   - Advanced protocol settings :
     - Scopes : `openid`, `email`, `profile` et **`offline_access`**. Le mapping par défaut
       `profile` inclut déjà le claim `groups`. `offline_access` fournit le refresh token
       grâce auquel le worker revérifie les droits toutes les 15 min
       (`ACCESS_RECHECK_MINUTES`).
     - Subject mode : **Based on the User's hashed ID**
3. **Application** (_Applications → Applications → Create_)
   - Nom : `Netflop`
   - Slug : `netflop`. C'est lui qui donne l'issuer `https://<AUTHENTIK_DOMAIN>/application/o/netflop/`.
   - Provider : `netflop`
   - Launch URL : `https://netflop.example.com`
4. **Restriction d'accès** (_application Netflop → onglet Policy / Group / User Bindings → Bind existing policy_)
   - Onglet **Group** → `netflop` → _Create_.
   - Dès qu'un binding existe, seuls les membres du groupe peuvent ouvrir l'application. Les autres sont refusés par Authentik.
   - Le hub refait aussi ce contrôle sur le claim `groups` (étape 2).

5. **Déconnexion complète** : la déconnexion du hub redirige vers
   `https://<AUTHENTIK_DOMAIN>/application/o/netflop/end-session/` avec
   `post_logout_redirect_uri=https://netflop.example.com/login?logout=1`. Dans le provider,
   ajoute cette URL aux _Redirect URIs_ (type _Post Logout_ si ta version d'Authentik le
   propose), sinon Authentik affiche sa propre page de fin de session.
6. **Avatar** (facultatif) : Authentik n'envoie pas de claim `picture` par défaut. Pour
   afficher les avatars, ajoute un _Scope Mapping_ sur le scope `profile` renvoyant
   `{"picture": request.user.avatar}`.

## Gérer les utilisateurs

- **Ajouter un utilisateur** : l'ajouter au groupe Authentik `netflop`. Il n'y a rien
  d'autre à faire. À sa première connexion, il choisit ses abonnements (onboarding), puis
  se connecte une fois à chaque plateforme dans son navigateur Netflop.
- **Administrateur** : l'ajouter aussi au groupe `netflop-admins`. Le rôle est relu à
  chaque connexion.
- **Retirer l'accès** : le sortir du groupe `netflop` (ou désactiver son compte). Ses
  sessions Netflop sont supprimées et son navigateur arrêté au plus tard 15 min après.
  Pour couper immédiatement :

  ```bash
  docker compose exec db psql -U netflop -c "delete from session where \"userId\" = (select id from \"user\" where slug = '<slug>');"
  ```

  Les pages sont coupées tout de suite, et `/b/<slug>` au plus 30 s plus tard (cache du
  forwardAuth).

## Diagnostic d'un navigateur

Pour tester un navigateur sans passer par le hub (image, routage Traefik, WebRTC) :

```bash
# Crée et démarre neko-alice sur le slot 0
docker compose exec worker node test-browser.js alice
docker compose exec worker node test-browser.js --list

# Traefik doit exposer la route automatiquement : 401 sans session (et non 404)
curl -sI https://<HUB_DOMAIN>/b/alice/ | head -1
docker logs <conteneur traefik> 2>&1 | grep netflop-b-alice   # aucune erreur de routeur

# Accès direct, sans le forwardAuth : tunnel SSH vers l'IP fixe du navigateur
# (slot 0 → 172.30.250.10), puis ouvre l'URL affichée par test-browser.js.
# Le flux WebRTC passe quand même par <PUBLIC_IP>:52000.
ssh -N -L 8080:172.30.250.10:8080 <utilisateur>@<serveur>

docker stats neko-alice                                         # RAM/CPU pendant une lecture
docker compose exec worker node test-browser.js alice --rm      # le volume est conservé
```

## Utilisation au quotidien

- **Ressources** : 3 navigateurs maximum (`MAX_ACTIVE_BROWSERS`). Un 4e utilisateur est mis
  en file d'attente et servi automatiquement.
- **Arrêt automatique** du navigateur dans ces cas :
  - onglet fermé (après 30 s de grâce) ;
  - heartbeat perdu (60 s) ;
  - pas de réponse à « Tu regardes toujours ? » ;
  - vidéo en pause depuis 30 min.
- **Logs lisibles** (JSON, une ligne par événement) :

  ```bash
  docker compose logs -f worker | grep -E 'séance|file|arrêt|JustWatch|TMDB'
  ```

- **Mobile** : ajouter Netflop à l'écran d'accueil (Safari : _Partager → Sur l'écran
  d'accueil_). Le bouton _Clavier_ sert à taper ses identifiants de plateforme.
- **Mode économie de données** (`/profil`) : 1024×576. C'est le plus petit mode 16:9 de
  Neko : il n'y a pas de 480p. Le réglage s'applique au prochain démarrage du navigateur.

## Mise à jour

```bash
cd netflop && git pull
docker compose --profile build build --pull browser-image   # nouvelle version Neko/Chrome
docker compose up -d --build                                # migrations appliquées automatiquement
```

Les navigateurs déjà en cours gardent l'ancienne image. La nouvelle s'applique au
démarrage suivant de chaque navigateur.

## Sauvegarde et restauration

La sauvegarde contient la base Postgres (comptes, abonnements, historique) et les volumes
`netflop-profile-*` (connexions aux plateformes) :

```bash
sudo scripts/backup.sh                       # → /var/backups/netflop/<date>/, rotation 14 jours
sudo scripts/restore.sh /var/backups/netflop/<date>            # base + profils
sudo scripts/restore.sh /var/backups/netflop/<date> --db       # base seule
```

- Les profils des navigateurs en cours sont sautés, car leur copie serait incohérente.
  Lance donc la sauvegarde la nuit :

  ```cron
  # /etc/cron.d/netflop
  30 4 * * * root /chemin/vers/netflop/scripts/backup.sh >>/var/log/netflop-backup.log 2>&1
  ```

- Pense à copier `/var/backups/netflop` **hors de la machine** (rsync, restic…).
- Teste la restauration de temps en temps, par exemple sur une autre machine.

## Dépannage

**Chrome ne démarre pas** :

```bash
docker exec neko-<user> tail -50 /var/log/neko/google-chrome.log
```

- Vérifie que `shm_size` vaut bien 2 Go.
- Profil corrompu : l'utilisateur clique sur _Profil → Réinitialiser mon navigateur_, avec le navigateur éteint.
- Démarrage bloqué au-delà de 3 min : le worker libère le slot tout seul. Regarde `docker compose logs worker`.

**Écran noir ou WebRTC bloqué** :

- Le port du slot doit être joignable en UDP depuis l'extérieur.
- `PUBLIC_IP` doit être la bonne IPv4.
- Le repli TCP passe par le même numéro de port. Un réseau d'entreprise peut bloquer les deux.

**L'iframe reste noire, ou Neko demande un nom** :

- Le hub ouvre `/b/<slug>/?usr=<slug>&pwd=netflop&embed=1`.
- Si une autre version du client Neko ignore ces paramètres, connecte-toi une fois à la
  main dans l'iframe.
- Signale-le : le chemin se règle dans `components/watch/watch-client.tsx`.

**Tapotements ou défilement qui ne passent pas sur mobile** :

- Le client Neko 3 gère le tactile.
- Si le défilement ne passe pas, utilise le bouton _Clavier_ (Tab, Entrée) ou fais défiler
  avec deux doigts.

**Ouverture d'un titre sur la mauvaise page** :

- Le lien JustWatch est peut-être absent (API non officielle). Dans ce cas, Netflop ouvre la
  recherche de la plateforme.
- Après 5 erreurs JustWatch consécutives, le log affiche
  « JustWatch désactivé temporairement » : la désactivation dure 1 h.
- Les modèles d'URL de recherche sont dans `lib/platforms.ts`.

**Le suivi ne reconnaît pas un contenu** :

- Il apparaît dans _Historique → À confirmer_.
- Les sélecteurs DOM et les motifs d'URL de lecture se règlent par plateforme dans
  `lib/platforms.ts`. Ils sont fragiles par nature.

**`/b/<user>/` renvoie 404** :

- Le conteneur n'est pas démarré, ou il n'est pas sur `TRAEFIK_NETWORK`.
- Regarde les logs de Traefik, en cherchant `netflop-b-<user>`.

**Middleware `netflop-browser-auth@docker` introuvable** :

- Le hub doit être démarré, car c'est lui qui déclare les middlewares.
- Le provider Docker de Traefik doit s'appeler `docker`.

**docker-proxy refuse les connexions** (SELinux/AppArmor) :

- Ajoute `privileged: true` au service `docker-proxy`, comme le recommande Tecnativa.

**Une plateforme refuse la lecture** :

- Netflix sous Chrome Linux est limité à 720p (Widevine L3) : c'est normal.
- Certains contenus Canal+ (HBO Max, Apple TV+) peuvent exiger un niveau DRM plus élevé. Vérifie `chrome://components` → _Widevine Content Decryption Module_.

## Sécurité (résumé)

- **Réseaux séparés** :
  - les navigateurs ne sont que sur `netflop-browsers`, avec hub, worker et Traefik ;
  - Postgres et docker-proxy sont sur `netflop-internal` (`internal: true`, sans accès
    Internet), injoignables depuis un navigateur ;
  - les navigateurs ne voient pas non plus les autres services de la machine présents sur le
    réseau Traefik.
- **Neko** : un mot de passe propre à chaque séance, dérivé d'`AUTH_SECRET` et jamais
  stocké, en plus du forwardAuth.
- **CDP** : le relais n'accepte que le hub et le worker (`socat range=…/31`).
- **Revérification Authentik** toutes les 15 min : retrait du groupe ou compte désactivé →
  sessions supprimées.
- **En-têtes du hub** : CSP (`frame-ancestors 'none'`), X-Frame-Options, HSTS, nosniff,
  Permissions-Policy.

- **Socket Docker** : il n'est monté que dans `docker-proxy`, limité aux conteneurs, réseaux
  et volumes. Ni le hub ni le worker n'y accèdent directement.
- **Configuration Docker figée** : la configuration des conteneurs est figée dans
  `lib/browser-spec.ts`. Le seul paramètre variable est le slug, validé par
  `^[a-z0-9_-]{1,32}$`.
- **CDP** : le port 9223 n'écoute que sur l'IP interne fixe du navigateur. Il n'est jamais
  publié ni routé par Traefik.
- **Navigation** : toute URL ouverte dans Chrome passe par une liste blanche de domaines
  (`validateNavigationUrl`), en https uniquement.
- **Accès aux navigateurs** : `/b/<slug>` est protégé par le forwardAuth (401 sans session,
  403 sur le navigateur d'un autre), avec la CSP `frame-ancestors` du hub.
- **Sessions** : stockées en base, cookies `__Secure-`, HttpOnly, SameSite=Lax.
- **Secrets** : la clé TMDB et les secrets restent côté serveur. Pour vérifier :

  ```bash
  docker compose exec hub sh -c 'grep -rl "$TMDB_API_KEY" .next/static || echo OK'
  ```

## Développement

```bash
bun install
bun run dev                 # hub en local (DATABASE_URL vers un Postgres local)
bun run db:generate         # nouvelle migration après modification de lib/db/schema.ts
bun run test                # Vitest (unitaires)
TEST_DATABASE_URL=postgresql://…/netflop_test bun run test   # + intégration (Postgres jetable)
bun run build && E2E_DATABASE_URL=postgresql://…/netflop_e2e bun run test:e2e   # Playwright
CAPTURES=1 bunx playwright test captures   # captures d'écran → e2e/captures/
bun run lint && bun run typecheck && bun run format:check
```

**Attention** : les bases de test (`TEST_DATABASE_URL`, `E2E_DATABASE_URL`) sont **vidées** à
chaque lancement.
