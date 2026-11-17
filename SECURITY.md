# Sécurité

Netflop est un projet personnel, destiné à être auto-hébergé pour un usage privé.

## Signaler une vulnérabilité

Merci de **ne pas ouvrir d'issue publique**. Utilise plutôt la fonction
_« Report a vulnerability »_ (signalement privé) de l'onglet _Security_ du dépôt.

Indique si possible :

- la version (commit) concernée ;
- les étapes de reproduction ;
- l'impact estimé.

## Recommandations de déploiement

- Garde `.env` hors du dépôt (`chmod 600`), avec des secrets générés aléatoirement.
- Mets à jour régulièrement les images (`docker compose build --pull`), en particulier
  l'image des navigateurs, pour suivre les correctifs de Chrome.
- Suis la section « Sécurité » et la configuration réseau décrites dans le README.
