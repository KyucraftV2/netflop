import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { watchlist } from "./db/schema";
import { errorMessage, logger } from "./log";
import { PLATFORM_IDS, type PlatformId } from "./platforms";
import { mapLimit, titlePlatforms, type MediaType } from "./tmdb";

/**
 * « Ma liste » : titres mis de côté. Toutes les requêtes sont filtrées par userId.
 * Un film terminé (suivi automatique ou « vu » manuel) en est retiré automatiquement.
 */

const log = logger("watchlist");

export const WATCHLIST_MAX = 200;

export const watchlistItemSchema = z.object({
  tmdbId: z.number().int().positive(),
  type: z.enum(["movie", "tv"]),
  title: z.string().trim().min(1).max(300),
  year: z.number().int().min(1870).max(2200).nullable(),
  posterPath: z
    .string()
    .regex(/^\/[A-Za-z0-9_-]+\.(jpg|png)$/)
    .nullable(),
  platforms: z.array(z.enum(PLATFORM_IDS)).max(PLATFORM_IDS.length),
});
export type WatchlistItem = z.infer<typeof watchlistItemSchema>;

export interface WatchlistCard extends WatchlistItem {
  addedAt: Date;
}

export const watchlistKey = (type: MediaType, tmdbId: number) => `${type}-${tmdbId}`;

/** Ajoute un titre (idempotent). false si la liste est pleine. */
export async function addToWatchlist(userId: string, item: WatchlistItem): Promise<boolean> {
  const db = getDb();
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(watchlist)
    .where(eq(watchlist.userId, userId));
  if (n >= WATCHLIST_MAX) return false;
  await db
    .insert(watchlist)
    .values({ userId, ...item })
    .onConflictDoNothing({ target: [watchlist.userId, watchlist.tmdbId, watchlist.type] });
  return true;
}

export async function removeFromWatchlist(
  userId: string,
  tmdbId: number,
  type: MediaType,
): Promise<void> {
  await getDb()
    .delete(watchlist)
    .where(
      and(eq(watchlist.userId, userId), eq(watchlist.tmdbId, tmdbId), eq(watchlist.type, type)),
    );
}

/** Clés `type-tmdbId` des titres de la liste (état des boutons « + Ma liste »). */
export async function watchlistKeys(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ tmdbId: watchlist.tmdbId, type: watchlist.type })
    .from(watchlist)
    .where(eq(watchlist.userId, userId));
  return rows.map((r) => watchlistKey(r.type, r.tmdbId));
}

/**
 * La liste, du plus récent au plus ancien. Les plateformes sont rafraîchies via TMDB
 * (en cache 24 h) ; en cas d'erreur, on garde celles connues à l'ajout.
 */
export async function listWatchlist(
  userId: string,
  opts: { refresh?: boolean; limit?: number } = {},
): Promise<WatchlistCard[]> {
  const rows = await getDb()
    .select()
    .from(watchlist)
    .where(eq(watchlist.userId, userId))
    .orderBy(desc(watchlist.addedAt), desc(watchlist.id))
    .limit(opts.limit ?? WATCHLIST_MAX);
  const refresh = opts.refresh ?? true;
  return mapLimit(rows, 6, async (r) => {
    let platforms = r.platforms.filter((p): p is PlatformId =>
      (PLATFORM_IDS as readonly string[]).includes(p),
    );
    if (refresh) {
      try {
        platforms = await titlePlatforms(r.type, r.tmdbId);
      } catch (err) {
        log.debug("plateformes non rafraîchies", { tmdbId: r.tmdbId, error: errorMessage(err) });
      }
    }
    return {
      tmdbId: r.tmdbId,
      type: r.type,
      title: r.title,
      year: r.year,
      posterPath: r.posterPath,
      platforms,
      addedAt: r.addedAt,
    };
  });
}

/** Retire un film terminé de la liste (appelé par le suivi et par « marquer comme vu »). */
export async function removeWatchedMovie(userId: string, tmdbId: number): Promise<void> {
  await removeFromWatchlist(userId, tmdbId, "movie");
}
