# Contribuer à Netflop

## Développement

Voir la section « Développement » du README : `bun install`, Postgres local, `bun run test`,
`bun run test:e2e`. La CI lance lint, types, format, tests et parcours Playwright sur chaque PR.

Conventions : commits en français, validation des entrées avec zod, migrations versionnées
(`bun run db:generate` après une modification de `lib/db/schema.ts`), aucun secret dans le
dépôt.

## Ajouter une plateforme

Toute la configuration d'une plateforme tient dans **une entrée de `lib/platforms.ts`**,
un logo et des tests.

### 1. Déclarer la plateforme

1. Ajoute son identifiant à `PLATFORM_IDS` (minuscules, sans espace : `primevideo`).
2. Ajoute son entrée dans `PLATFORMS` :

| Champ                      | Rôle                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `name`, `tagline`          | Nom affiché, mention facultative sous le logo (« gratuit », « inclut … »)                           |
| `homeUrl`                  | Page ouverte quand on lance la plateforme sans titre                                                |
| `searchUrlTemplate`        | Recherche de la plateforme (`{q}` = titre encodé), utilisée si aucun lien direct n'est trouvé       |
| `color`, `textColor`       | Couleurs du badge et de la tuile                                                                    |
| `logo`                     | Chemin du logo dans `public/`                                                                       |
| `tmdbProviderNamePatterns` | Expressions sur le **nom** du fournisseur TMDB/JustWatch, normalisé (minuscules, sans accents)      |
| `allowedDomains`           | Domaines (et sous-domaines) où le hub peut faire naviguer Chrome                                    |
| `playbackUrlPatterns`      | URL des pages de **lecture** : le suivi ne collecte rien ailleurs                                   |
| `domSelectors`             | Sélecteurs CSS du titre et de l'épisode dans le lecteur (secours si le titre de page ne suffit pas) |
| `documentTitleSuffixes`    | Suffixes à retirer de `document.title` (« - Netflix »…)                                             |

3. Génère la migration (la plateforme est une valeur de l'enum Postgres `platform`) :

   ```bash
   bun run db:generate --name plateforme_<id>
   ```

### 2. Ajouter le logo

Dépose `public/platforms/<id>.svg` (fond transparent, ratio 200 × 60 environ) et choisis un `tileColor` sombre pour la tuile.
Les logos de marque appartiennent à leurs propriétaires : une marque texte suffit.

### 3. Trouver les bonnes valeurs

Dans un navigateur Netflop (ou un Chrome normal) :

- **Fournisseur TMDB** : `GET /3/watch/providers/movie?watch_region=FR` liste les noms
  exacts. Vérifie que le motif n'attrape pas une autre offre (« … Amazon Channel » est
  déjà exclu globalement).
- **Domaines** : onglet Réseau des outils de développement pendant une connexion et une
  lecture. Note les domaines de la page, de l'authentification, du lecteur et du CDN.
- **URL de lecture** : l'adresse pendant la lecture d'un épisode et d'un film. Évite les
  motifs qui attrapent les pages de présentation, où des bandes-annonces se lancent seules.
  Le suivi écarte de toute façon les vidéos de moins de 3 minutes.
- **Sélecteurs** : inspecte le titre affiché dans le lecteur (souvent visible seulement
  quand on bouge la souris).

### 4. Tester

- `tests/unit/platforms.test.ts` : correspondance des noms de fournisseurs, URL de
  lecture (positives et négatives), domaines.
- `tests/unit/episode.test.ts` si le format d'épisode est nouveau (« S1 E3 », « Épisode 3 »…).
- En réel : lancer la plateforme, ouvrir un titre depuis la recherche, regarder 5 minutes
  et vérifier « Continuer à regarder », puis l'épisode suivant.

### 5. Liste blanche de Chrome

Les domaines de `allowedDomains` servent aussi à générer la liste blanche d'URL de
l'image navigateur (option `NETFLOP_URL_ALLOWLIST`). Ajoute ceux du CDN et de la
connexion (pages d'authentification, captcha) si la plateforme en utilise d'autres.

### Plateformes non validées en conditions réelles

`primevideo`, `disneyplus`, `arte`, `tf1plus` et `m6plus` ont été ajoutées à partir de la
structure publique de leurs sites. Leurs **URL de lecture, sélecteurs et domaines sont à
confirmer**. Une instance peut les masquer avec `NETFLOP_PLATFORMS` en attendant.
