import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "./db";
import { watchlist, watchProgress } from "./db/schema";
import { errorMessage, logger } from "./log";
import type { PlatformId } from "./platforms";
import {
  mapLimit,
  recommendations,
  titlePlatforms,
  type MediaType,
  type TitleSummary,
} from "./tmdb";

/**
 * Rangée « Pour toi » : recommandations TMDB des derniers titres vus (et des derniers
 * ajouts à « Ma liste »), limitées aux titres disponibles sur les abonnements de
 * l'utilisateur, sans ce qu'il a déjà regardé ou mis de côté.
 */

const log = logger("recommendations");

const SEEDS_FROM_HISTORY = 5;
const SEEDS_FROM_WATCHLIST = 2;
/** Candidats dont on vérifie la disponibilité (appels TMDB, en cache 24 h). */
const CANDIDATES = 40;

export interface Recommendation extends TitleSummary {
  platforms: PlatformId[];
}

type Seed = { tmdbId: number; type: MediaType };
const key = (s: Seed) => `${s.type}-${s.tmdbId}`;

/** Classement : un titre recommandé par plusieurs sources récentes passe devant. */
export function rankCandidates(
  lists: TitleSummary[][],
  exclude: Set<string>,
  limit = CANDIDATES,
): TitleSummary[] {
  const scored = new Map<string, { item: TitleSummary; score: number }>();
  lists.forEach((list, seedRank) => {
    const seedWeight = 1 / (seedRank + 1);
    list.forEach((item, rank) => {
      const k = key(item);
      if (exclude.has(k)) return;
      const add = seedWeight * (1 / (rank + 1) + 0.05);
      const cur = scored.get(k);
      if (cur) cur.score += add;
      else scored.set(k, { item, score: add });
    });
  });
  return [...scored.values()]
    .sort((a, b) => b.score - a.score || b.item.popularity - a.item.popularity)
    .slice(0, limit)
    .map((s) => s.item);
}

export async function forYou(
  userId: string,
  subscribed: PlatformId[],
  limit = 20,
): Promise<Recommendation[]> {
  if (subscribed.length === 0) return [];
  const db = getDb();
  const [history, saved] = await Promise.all([
    db
      .select({
        tmdbId: watchProgress.tmdbId,
        type: watchProgress.type,
        at: watchProgress.lastWatchedAt,
      })
      .from(watchProgress)
      .where(
        and(
          eq(watchProgress.userId, userId),
          isNotNull(watchProgress.tmdbId),
          isNotNull(watchProgress.type),
        ),
      )
      .orderBy(desc(watchProgress.lastWatchedAt)),
    db
      .select({ tmdbId: watchlist.tmdbId, type: watchlist.type })
      .from(watchlist)
      .where(eq(watchlist.userId, userId))
      .orderBy(desc(watchlist.addedAt)),
  ]);

  const watched = history.map((h) => ({ tmdbId: h.tmdbId!, type: h.type! }));
  const exclude = new Set([...watched.map(key), ...saved.map(key)]);
  const seeds: Seed[] = [];
  const seen = new Set<string>();
  for (const s of [
    ...dedupe(watched).slice(0, SEEDS_FROM_HISTORY),
    ...saved.slice(0, SEEDS_FROM_WATCHLIST),
  ]) {
    if (!seen.has(key(s))) {
      seen.add(key(s));
      seeds.push(s);
    }
  }
  if (seeds.length === 0) return [];

  const lists = await mapLimit(seeds, 3, (s) =>
    recommendations(s.type, s.tmdbId).catch((err: unknown) => {
      log.debug("recommandations indisponibles", { tmdbId: s.tmdbId, error: errorMessage(err) });
      return [] as TitleSummary[];
    }),
  );
  const candidates = rankCandidates(lists, exclude);
  const withPlatforms = await mapLimit(candidates, 6, async (c) => ({
    ...c,
    platforms: await titlePlatforms(c.type, c.tmdbId).catch(() => [] as PlatformId[]),
  }));
  return withPlatforms
    .map((c) => ({ ...c, platforms: c.platforms.filter((p) => subscribed.includes(p)) }))
    .filter((c) => c.platforms.length > 0)
    .slice(0, limit);
}

function dedupe(seeds: Seed[]): Seed[] {
  const seen = new Set<string>();
  return seeds.filter((s) => (seen.has(key(s)) ? false : (seen.add(key(s)), true)));
}
