/**
 * Configuration UNIQUE des plateformes. Ajouter une plateforme = ajouter une entrée ici
 * (+ son logo dans public/platforms/). Ce fichier est importable côté client : il ne
 * contient aucun secret.
 *
 * Les éléments marqués « fragile » dépendent du site de la plateforme et peuvent casser
 * sans prévenir ; leur échec ne doit jamais faire planter le hub (on passe au suivant).
 */

export const PLATFORM_IDS = [
  "netflix",
  "canalplus",
  "francetv",
  "primevideo",
  "disneyplus",
  "arte",
  "tf1plus",
  "m6plus",
] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export interface DomSelectors {
  /** Titre de l'œuvre (série ou film). */
  title?: string[];
  /** Libellé d'épisode (« S1:E3 », « Épisode 3 »…). */
  episode?: string[];
}

export interface Platform {
  id: PlatformId;
  name: string;
  /** Mention affichée sur la tuile (ex. services inclus). */
  tagline?: string;
  homeUrl: string;
  /** Modèle d'URL de recherche ; {q} = titre encodé. À vérifier à la main. */
  searchUrlTemplate: string;
  /** Couleur des badges (texte `textColor` dessus). */
  color: string;
  textColor: string;
  /** Fond des surfaces qui affichent le logo (tuiles, écrans de lecture) : contraste avec le logo. */
  tileColor: string;
  /** Logo (dans public/), utilisé UNIQUEMENT sur les tuiles et badges. */
  logo: string;
  /**
   * Correspondance des fournisseurs TMDB (par NOM, normalisé en minuscules, sans
   * accents). Pas d'ID codé en dur : les IDs sont résolus au démarrage via
   * /watch/providers/{movie,tv}?watch_region=FR.
   */
  tmdbProviderNamePatterns: RegExp[];
  /** Domaines autorisés pour la navigation CDP (le domaine lui-même et ses sous-domaines). */
  allowedDomains: string[];
  /** URL des pages de LECTURE : aucune collecte de suivi en dehors. Fragile. */
  playbackUrlPatterns: RegExp[];
  /** Sélecteurs DOM de secours pour identifier le contenu. Fragile. */
  domSelectors: DomSelectors;
  /** Suffixes à retirer de document.title (« - Netflix »…). */
  documentTitleSuffixes: RegExp[];
}

export const PLATFORMS: Record<PlatformId, Platform> = {
  netflix: {
    id: "netflix",
    name: "Netflix",
    homeUrl: "https://www.netflix.com/browse",
    searchUrlTemplate: "https://www.netflix.com/search?q={q}",
    color: "#b20710",
    textColor: "#ffffff",
    tileColor: "#000000",
    logo: "/platforms/netflix.svg",
    tmdbProviderNamePatterns: [/^netflix\b/],
    allowedDomains: ["netflix.com", "nflxext.com", "nflxvideo.net", "nflximg.net"],
    playbackUrlPatterns: [/^https:\/\/www\.netflix\.com\/watch\/\d+/],
    domSelectors: {
      title: ['[data-uia="video-title"] h4', '[data-uia="video-title"]'],
      episode: ['[data-uia="video-title"] span'],
    },
    documentTitleSuffixes: [/\s*[-|–]\s*Netflix\s*$/i],
  },
  canalplus: {
    id: "canalplus",
    name: "Canal+",
    tagline: "inclut HBO Max et Apple TV+",
    homeUrl: "https://www.canalplus.com/",
    searchUrlTemplate: "https://www.canalplus.com/recherche/?q={q}",
    color: "#111111",
    textColor: "#ffffff",
    tileColor: "#000000",
    logo: "/platforms/canalplus.svg",
    // Canal+ regroupe les contenus HBO Max et Apple TV+ (regardés via Canal+).
    tmdbProviderNamePatterns: [
      /^canal\s*\+/,
      /^canal plus/,
      /^(hbo )?max$/,
      /^hbo max/,
      /^apple tv/,
    ],
    allowedDomains: ["canalplus.com", "canal-plus.com", "mycanal.fr", "canalplus-cdn.net"],
    playbackUrlPatterns: [
      /^https:\/\/www\.canalplus\.com\/.*(?:\/lecture\/|\/player\/|[?&#]play)/,
      /^https:\/\/www\.canalplus\.com\/live\//,
    ],
    domSelectors: {
      title: ['[class*="playerTitle"]', '[class*="PlayerTitle"]', '[data-testid="player-title"]'],
      episode: ['[class*="playerSubtitle"]', '[class*="PlayerSubtitle"]'],
    },
    documentTitleSuffixes: [/\s*[-|–]\s*(?:my)?canal\+?.*$/i, /\s*[-|–]\s*CANAL\+.*$/],
  },
  francetv: {
    id: "francetv",
    name: "france.tv",
    homeUrl: "https://www.france.tv/",
    searchUrlTemplate: "https://www.france.tv/recherche/?q={q}",
    color: "#1d3fbb",
    textColor: "#ffffff",
    tileColor: "#0b1533",
    logo: "/platforms/francetv.svg",
    tmdbProviderNamePatterns: [/^france\.?\s?tv/],
    allowedDomains: ["france.tv", "francetv.fr", "ftven.fr"],
    playbackUrlPatterns: [/^https:\/\/www\.france\.tv\/.+\/\d+-[^/]+\.html/],
    domSelectors: {
      title: ['[data-testid="video-title"]', "h1"],
      episode: ['[data-testid="video-subtitle"]', "h2"],
    },
    documentTitleSuffixes: [/\s*[-|–]\s*france\.tv\s*$/i, /\s*[-|–]\s*france\.tv.*$/i],
  },
  // Plateformes ajoutées sans validation en conditions réelles : URL de lecture, sélecteurs
  // et domaines « fragiles » à confirmer (voir CONTRIBUTING.md).
  primevideo: {
    id: "primevideo",
    name: "Prime Video",
    homeUrl: "https://www.primevideo.com/",
    searchUrlTemplate: "https://www.primevideo.com/search/?phrase={q}",
    color: "#0f79af",
    textColor: "#ffffff",
    logo: "/platforms/primevideo.svg",
    tileColor: "#0a1a24",
    tmdbProviderNamePatterns: [/^amazon prime video\b/, /^prime video\b/],
    allowedDomains: [
      "primevideo.com",
      "amazon.fr",
      "amazon.com",
      "media-amazon.com",
      "ssl-images-amazon.com",
      "amazonvideo.com",
      "aiv-cdn.net",
      "aiv-delivery.net",
      "pv-cdn.net",
    ],
    // Lecteur superposé à la page du titre (pas d'URL dédiée) : le tracker se fie à la
    // durée de la vidéo (≥ 3 min) pour écarter les bandes-annonces.
    playbackUrlPatterns: [/^https:\/\/www\.primevideo\.com\/.*(?:\/detail\/|\/watch\/)/],
    domSelectors: {
      title: [".atvwebplayersdk-title-text"],
      episode: [".atvwebplayersdk-subtitle-text"],
    },
    documentTitleSuffixes: [/\s*[-|–]\s*Prime Video\s*$/i, /^Prime Video\s*:\s*/i],
  },
  disneyplus: {
    id: "disneyplus",
    name: "Disney+",
    homeUrl: "https://www.disneyplus.com/fr-fr/home",
    searchUrlTemplate: "https://www.disneyplus.com/fr-fr/search?q={q}",
    color: "#0b3a8c",
    textColor: "#ffffff",
    logo: "/platforms/disneyplus.svg",
    tileColor: "#0a1433",
    tmdbProviderNamePatterns: [/^disney\s*(\+|plus)$/],
    allowedDomains: [
      "disneyplus.com",
      "disney-plus.net",
      "bamgrid.com",
      "dssott.com",
      "disneystreaming.com",
    ],
    playbackUrlPatterns: [
      /^https:\/\/www\.disneyplus\.com\/(?:[a-z]{2}-[a-z]{2}\/)?(?:video|play)\//,
    ],
    domSelectors: {
      title: [".title-field", '[data-testid="title-field"]'],
      episode: [".subtitle-field", '[data-testid="subtitle-field"]'],
    },
    documentTitleSuffixes: [/\s*[-|–]\s*Disney\+\s*$/i, /^Regarder\s+/i],
  },
  arte: {
    id: "arte",
    name: "ARTE",
    tagline: "gratuit",
    homeUrl: "https://www.arte.tv/fr/",
    searchUrlTemplate: "https://www.arte.tv/fr/search/?q={q}",
    color: "#c4401b",
    textColor: "#ffffff",
    logo: "/platforms/arte.svg",
    tileColor: "#1f0f0a",
    tmdbProviderNamePatterns: [/^arte\b/],
    allowedDomains: ["arte.tv", "arte.fr"],
    playbackUrlPatterns: [/^https:\/\/www\.arte\.tv\/[a-z]{2}\/videos\/\d{6}-\d{3}-[A-Z]\//],
    domSelectors: {
      title: ["h1"],
      episode: ['[data-testid="ts-subtitle"]', "h2"],
    },
    documentTitleSuffixes: [
      /\s*[-|–]\s*Regarder le (?:film|documentaire|programme) complet.*$/i,
      /\s*[|–-]\s*ARTE.*$/i,
    ],
  },
  tf1plus: {
    id: "tf1plus",
    name: "TF1+",
    tagline: "gratuit",
    homeUrl: "https://www.tf1.fr/",
    searchUrlTemplate: "https://www.tf1.fr/recherche?q={q}",
    color: "#1e3fa0",
    textColor: "#ffffff",
    logo: "/platforms/tf1plus.svg",
    tileColor: "#0b1533",
    tmdbProviderNamePatterns: [/^tf1\s*\+/, /^tf1$/],
    allowedDomains: ["tf1.fr", "tf1info.fr", "tf1.tv"],
    playbackUrlPatterns: [/^https:\/\/www\.tf1\.fr\/.+\/videos\/[^/]+/],
    domSelectors: {
      title: ['[data-testid="player-title"]', "h1"],
      episode: ['[data-testid="player-subtitle"]', "h2"],
    },
    documentTitleSuffixes: [/\s*[-|–]\s*TF1\+?.*$/i],
  },
  m6plus: {
    id: "m6plus",
    name: "M6+",
    tagline: "gratuit",
    homeUrl: "https://www.m6.fr/",
    searchUrlTemplate: "https://www.m6.fr/recherche?q={q}",
    color: "#2a2a2a",
    textColor: "#ffffff",
    logo: "/platforms/m6plus.svg",
    tileColor: "#151515",
    tmdbProviderNamePatterns: [/^m6\s*\+/, /^6play\b/],
    allowedDomains: ["m6.fr", "6play.fr", "m6web.fr", "m6tvcdn.net"],
    playbackUrlPatterns: [/^https:\/\/www\.m6\.fr\/.+\/(?:videos?|player)\//],
    domSelectors: {
      title: ['[data-testid="player-title"]', "h1"],
      episode: ['[data-testid="player-subtitle"]', "h2"],
    },
    documentTitleSuffixes: [/\s*[-|–]\s*M6\+?.*$/i],
  },
};

export const PLATFORM_LIST: Platform[] = PLATFORM_IDS.map((id) => PLATFORMS[id]);

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && (PLATFORM_IDS as readonly string[]).includes(value);
}

export function getPlatform(id: PlatformId): Platform {
  return PLATFORMS[id];
}

/** Normalise un nom de fournisseur pour la correspondance (minuscules, sans accents). */
export function normalizeProviderName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Plateforme Netflop correspondant à un nom de fournisseur TMDB/JustWatch, ou null. */
export function platformForProviderName(name: string): PlatformId | null {
  const n = normalizeProviderName(name);
  // Exclut les offres boutique / chaînes Amazon (« Apple TV Store », « HBO Max Amazon Channel »…)
  if (/\b(store|amazon channel|channel)\b/.test(n)) return null;
  for (const p of PLATFORM_LIST) {
    if (p.tmdbProviderNamePatterns.some((re) => re.test(n))) return p.id;
  }
  return null;
}

/** Vrai si l'hôte est un domaine autorisé de la plateforme (ou un de ses sous-domaines). */
export function hostMatchesPlatform(host: string, platform: Platform): boolean {
  const h = host.toLowerCase();
  return platform.allowedDomains.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * Validation stricte d'une URL de navigation : https uniquement, pas d'identifiants,
 * port par défaut, domaine dans la liste blanche. Renvoie la plateforme ou null.
 */
export function validateNavigationUrl(raw: string): { url: URL; platform: PlatformId } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  for (const p of PLATFORM_LIST) {
    if (hostMatchesPlatform(url.hostname, p)) return { url, platform: p.id };
  }
  return null;
}

export function platformSearchUrl(id: PlatformId, query: string): string {
  return PLATFORMS[id].searchUrlTemplate.replace("{q}", encodeURIComponent(query));
}

export function isPlaybackUrl(id: PlatformId, href: string): boolean {
  return PLATFORMS[id].playbackUrlPatterns.some((re) => re.test(href));
}

/** Plateforme dont relève une URL (quelle que soit la page), ou null. */
export function platformForUrl(href: string): PlatformId | null {
  try {
    const host = new URL(href).hostname;
    return PLATFORM_LIST.find((p) => hostMatchesPlatform(host, p))?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Plateformes activées sur cette instance (côté serveur) : variable NETFLOP_PLATFORMS,
 * liste d'identifiants séparés par des virgules. Vide = toutes. Les identifiants
 * inconnus sont ignorés ; si aucun n'est valide, toutes restent actives.
 */
export function enabledPlatformIds(raw = process.env.NETFLOP_PLATFORMS): PlatformId[] {
  const wanted = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(isPlatformId);
  if (wanted.length === 0) return [...PLATFORM_IDS];
  // Ordre de PLATFORM_IDS, sans doublon.
  return PLATFORM_IDS.filter((id) => wanted.includes(id));
}

export function enabledPlatforms(raw?: string): Platform[] {
  return enabledPlatformIds(raw).map((id) => PLATFORMS[id]);
}

export function isPlatformEnabled(id: PlatformId, raw?: string): boolean {
  return enabledPlatformIds(raw).includes(id);
}
