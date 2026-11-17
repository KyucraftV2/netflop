import { z } from "zod";
import { cached } from "./cache";
import { errorMessage, logger } from "./log";
import { platformForProviderName, type PlatformId } from "./platforms";

/**
 * Client TMDB — SERVEUR UNIQUEMENT. La clé (TMDB_API_KEY) n'est jamais envoyée au
 * navigateur : toutes les requêtes passent par les route handlers du hub.
 * Cache : 1 h pour la recherche, 24 h pour les fournisseurs et les fiches.
 */

const log = logger("tmdb");
const LANG = "fr-FR";
const REGION = "FR";
export const SEARCH_TTL = 60 * 60;
export const PROVIDERS_TTL = 24 * 60 * 60;

export type MediaType = "movie" | "tv";

export interface TitleSummary {
  tmdbId: number;
  type: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  popularity: number;
}

export interface SearchResult extends TitleSummary {
  /** Plateformes Netflop où le titre est inclus dans l'abonnement (offres flatrate, FR). */
  platforms: PlatformId[];
}

export class TmdbError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TmdbError";
  }
}

function apiKey(): string {
  const key = process.env.TMDB_API_KEY;
  if (!key || key.startsWith("<")) throw new TmdbError(503, "TMDB_API_KEY non configurée");
  return key;
}

function baseUrl(): string {
  return (process.env.TMDB_API_BASE_URL ?? "https://api.themoviedb.org").replace(/\/+$/, "");
}

async function tmdbGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const key = apiKey();
  const url = new URL(`${baseUrl()}/3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { Accept: "application/json" };
  // Jeton v4 (JWT « eyJ… ») en Bearer, sinon clé v3 en paramètre.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set("api_key", key);

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) {
    log.warn("erreur TMDB", { path, status: res.status });
    throw new TmdbError(res.status, `TMDB ${res.status}`);
  }
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Schémas de réponse (tolérants : on ne garde que ce qui sert)        */
/* ------------------------------------------------------------------ */

const multiItem = z.object({
  id: z.number(),
  media_type: z.string().optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  original_title: z.string().optional(),
  original_name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  overview: z.string().optional().default(""),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  popularity: z.number().optional().default(0),
});
type MultiItem = z.infer<typeof multiItem>;

const pageSchema = z.object({
  page: z.number().default(1),
  total_pages: z.number().default(1),
  results: z.array(z.unknown()).default([]),
});

const providerSchema = z.object({
  provider_id: z.number(),
  provider_name: z.string(),
  logo_path: z.string().nullish(),
});

function yearOf(date: string | undefined): number | null {
  const y = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y > 1800 ? y : null;
}

export function toSummary(item: MultiItem, forcedType?: MediaType): TitleSummary | null {
  const type = (forcedType ?? item.media_type) as MediaType | undefined;
  if (type !== "movie" && type !== "tv") return null;
  const title = type === "movie" ? item.title : item.name;
  if (!title) return null;
  return {
    tmdbId: item.id,
    type,
    title,
    originalTitle: (type === "movie" ? item.original_title : item.original_name) ?? null,
    year: yearOf(type === "movie" ? item.release_date : item.first_air_date),
    overview: item.overview ?? "",
    posterPath: item.poster_path ?? null,
    backdropPath: item.backdrop_path ?? null,
    popularity: item.popularity ?? 0,
  };
}

function parseItems(raw: unknown[], forcedType?: MediaType): TitleSummary[] {
  const out: TitleSummary[] = [];
  for (const r of raw) {
    const p = multiItem.safeParse(r);
    if (!p.success) continue;
    const s = toSummary(p.data, forcedType);
    if (s) out.push(s);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Correspondance fournisseurs TMDB → plateformes (par nom, au démarrage) */
/* ------------------------------------------------------------------ */

let providerMap: { map: Map<number, PlatformId>; until: number } | null = null;

/**
 * Liste des fournisseurs FR (films + séries), correspondance PAR NOM via lib/platforms.ts.
 * Aucun ID codé en dur. Cache 24 h (base) + mémoire.
 */
export async function providerPlatformMap(): Promise<Map<number, PlatformId>> {
  if (providerMap && providerMap.until > Date.now()) return providerMap.map;
  const lists = await cached(`tmdb:providers:${REGION}`, PROVIDERS_TTL, async () => {
    const [movie, tv] = await Promise.all(
      (["movie", "tv"] as const).map((t) =>
        tmdbGet<{ results?: unknown[] }>(`/watch/providers/${t}`, {
          watch_region: REGION,
          language: LANG,
        }),
      ),
    );
    return [...(movie?.results ?? []), ...(tv?.results ?? [])];
  });
  const map = new Map<number, PlatformId>();
  const matched: string[] = [];
  for (const raw of lists) {
    const p = providerSchema.safeParse(raw);
    if (!p.success) continue;
    const platform = platformForProviderName(p.data.provider_name);
    if (platform && !map.has(p.data.provider_id)) {
      map.set(p.data.provider_id, platform);
      matched.push(`${p.data.provider_name}→${platform}`);
    }
  }
  if (!providerMap) log.info("fournisseurs TMDB associés", { matched: matched.join(", ") });
  providerMap = { map, until: Date.now() + 60 * 60 * 1000 };
  return map;
}

/** Plateformes Netflop proposant le titre en abonnement (flatrate) en France. */
export async function titlePlatforms(type: MediaType, tmdbId: number): Promise<PlatformId[]> {
  const [map, raw] = await Promise.all([
    providerPlatformMap(),
    cached(`tmdb:wp:${type}:${tmdbId}`, PROVIDERS_TTL, () =>
      tmdbGet<{ results?: Record<string, { flatrate?: unknown[] }> }>(
        `/${type}/${tmdbId}/watch/providers`,
      ),
    ),
  ]);
  const flatrate = raw?.results?.[REGION]?.flatrate ?? [];
  const out = new Set<PlatformId>();
  for (const f of flatrate) {
    const p = providerSchema.safeParse(f);
    if (!p.success) continue;
    const platform = map.get(p.data.provider_id) ?? platformForProviderName(p.data.provider_name);
    if (platform) out.add(platform);
  }
  return [...out];
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}

/** /search/multi (films + séries), fr-FR, région FR, avec disponibilité par plateforme. */
export async function searchTitles(query: string, page = 1): Promise<SearchResult[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const summaries = await cached(`tmdb:search:${q.toLowerCase()}:${page}`, SEARCH_TTL, async () => {
    const data = pageSchema.parse(
      await tmdbGet("/search/multi", {
        query: q,
        language: LANG,
        region: REGION,
        include_adult: "false",
        page,
      }),
    );
    return parseItems(data.results);
  });
  return mapLimit(summaries, 6, async (s) => ({
    ...s,
    platforms: await titlePlatforms(s.type, s.tmdbId).catch((err: unknown) => {
      log.warn("fournisseurs indisponibles", { tmdbId: s.tmdbId, error: errorMessage(err) });
      return [];
    }),
  }));
}

export const RECOMMENDATIONS_TTL = 24 * 60 * 60;

/** Titres recommandés par TMDB à partir d'un titre (même type), cache 24 h. */
export async function recommendations(type: MediaType, tmdbId: number): Promise<TitleSummary[]> {
  return cached(`tmdb:reco:${type}:${tmdbId}`, RECOMMENDATIONS_TTL, async () => {
    const data = pageSchema.parse(
      await tmdbGet(`/${type}/${tmdbId}/recommendations`, { language: LANG, page: 1 }),
    );
    return parseItems(data.results, type);
  });
}

/** Recherche typée (film OU série) — utilisée par l'identification du suivi (étape 5). */
export async function searchByType(type: MediaType, query: string): Promise<TitleSummary[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  return cached(`tmdb:search-${type}:${q.toLowerCase()}`, SEARCH_TTL, async () => {
    const data = pageSchema.parse(
      await tmdbGet(`/search/${type}`, { query: q, language: LANG, region: REGION }),
    );
    return parseItems(data.results, type);
  });
}

const detailsSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  name: z.string().optional(),
  original_title: z.string().optional(),
  original_name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  overview: z.string().optional().default(""),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  popularity: z.number().optional().default(0),
  runtime: z.number().nullish(),
  number_of_seasons: z.number().nullish(),
  seasons: z
    .array(
      z.object({
        season_number: z.number(),
        episode_count: z.number().default(0),
        air_date: z.string().nullish(),
      }),
    )
    .optional()
    .default([]),
});

export interface TitleDetails extends TitleSummary {
  runtimeMinutes: number | null;
  seasons: { season: number; episodeCount: number; airDate: string | null }[];
}

export async function titleDetails(type: MediaType, tmdbId: number): Promise<TitleDetails> {
  const raw = await cached(`tmdb:details:${type}:${tmdbId}`, PROVIDERS_TTL, () =>
    tmdbGet(`/${type}/${tmdbId}`, { language: LANG }),
  );
  const d = detailsSchema.parse(raw);
  const summary = toSummary(d as MultiItem, type);
  if (!summary) throw new TmdbError(404, "Titre introuvable");
  return {
    ...summary,
    runtimeMinutes: d.runtime ?? null,
    seasons: d.seasons.map((s) => ({
      season: s.season_number,
      episodeCount: s.episode_count,
      airDate: s.air_date ?? null,
    })),
  };
}

/**
 * Épisode suivant (passage à la saison suivante si besoin). Ignore les « saisons 0 »
 * (bonus) et les épisodes pas encore diffusés.
 */
export function nextEpisodeFrom(
  seasons: TitleDetails["seasons"],
  season: number,
  episode: number,
  today = new Date(),
): { season: number; episode: number } | null {
  const regular = seasons.filter((s) => s.season > 0 && s.episodeCount > 0);
  const current = regular.find((s) => s.season === season);
  if (current && episode < current.episodeCount) return { season, episode: episode + 1 };
  const next = regular
    .filter((s) => s.season > season)
    .sort((a, b) => a.season - b.season)
    .find((s) => !s.airDate || new Date(s.airDate) <= today);
  return next ? { season: next.season, episode: 1 } : null;
}

export async function nextEpisode(
  tmdbId: number,
  season: number,
  episode: number,
): Promise<{ season: number; episode: number } | null> {
  const d = await titleDetails("tv", tmdbId);
  return nextEpisodeFrom(d.seasons, season, episode);
}

export function posterUrl(path: string | null, size: "w185" | "w342" | "w500" = "w342") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

export function backdropUrl(path: string | null, size: "w780" | "w1280" = "w1280") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}
