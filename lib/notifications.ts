import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { episodeNotifications, pushSubscriptions, users, watchProgress } from "./db/schema";
import { errorMessage, logger } from "./log";
import { PLATFORMS, type PlatformId } from "./platforms";
import { sendToUser, type PushSender } from "./push";
import { airedWithin, lastAiredEpisode, type AiredEpisode } from "./tmdb";

/**
 * Notifications envoyées par le worker :
 *  - nouvel épisode d'une série suivie (diffusé depuis moins de NEW_EPISODE_DAYS jours,
 *    après le dernier épisode vu) ; une seule fois par épisode ;
 *  - « C'est ton tour » quand un utilisateur en file obtient un navigateur.
 */

const log = logger("notifications");

export const NEW_EPISODE_DAYS = 7;
/** Séries regardées depuis moins de N jours seulement. */
const FOLLOWED_DAYS = 120;

const epKey = (season: number, episode: number) => season * 10_000 + episode;

export interface NotificationDeps {
  sender?: PushSender;
  lastAired?: (tmdbId: number) => Promise<AiredEpisode | null>;
  now?: number;
}

/** Une passe : renvoie le nombre de notifications « nouvel épisode » envoyées. */
export async function notifyNewEpisodes(deps: NotificationDeps = {}): Promise<number> {
  const db = getDb();
  const now = deps.now ?? Date.now();
  const lastAired = deps.lastAired ?? lastAiredEpisode;

  // Séries suivies (dernier épisode vu le plus avancé) des utilisateurs abonnés aux notifications.
  const followed = await db
    .select({
      userId: watchProgress.userId,
      tmdbId: watchProgress.tmdbId,
      title: sql<string>`max(${watchProgress.title})`,
      platform: sql<PlatformId>`(array_agg(${watchProgress.platform} order by ${watchProgress.lastWatchedAt} desc))[1]`,
      maxKey: sql<number>`max(${watchProgress.season} * 10000 + ${watchProgress.episode})`,
    })
    .from(watchProgress)
    .innerJoin(users, eq(users.id, watchProgress.userId))
    .where(
      and(
        eq(users.notifyNewEpisodes, true),
        eq(watchProgress.type, "tv"),
        isNotNull(watchProgress.tmdbId),
        eq(watchProgress.needsReview, false),
        gte(watchProgress.lastWatchedAt, new Date(now - FOLLOWED_DAYS * 86_400_000)),
        sql`exists (select 1 from ${pushSubscriptions} where ${pushSubscriptions.userId} = ${watchProgress.userId})`,
      ),
    )
    .groupBy(watchProgress.userId, watchProgress.tmdbId);

  const airedCache = new Map<number, AiredEpisode | null>();
  let sent = 0;
  for (const f of followed) {
    const tmdbId = f.tmdbId!;
    try {
      if (!airedCache.has(tmdbId)) airedCache.set(tmdbId, await lastAired(tmdbId));
      const aired = airedCache.get(tmdbId);
      if (!aired || !airedWithin(aired.airDate, NEW_EPISODE_DAYS, now)) continue;
      if (epKey(aired.season, aired.episode) <= Number(f.maxKey)) continue;
      const inserted = await db
        .insert(episodeNotifications)
        .values({ userId: f.userId, tmdbId, season: aired.season, episode: aired.episode })
        .onConflictDoNothing()
        .returning({ tmdbId: episodeNotifications.tmdbId });
      if (inserted.length === 0) continue;
      const n = await sendToUser(
        f.userId,
        {
          title: `Nouvel épisode : ${f.title}`,
          body: `S${aired.season} · É${aired.episode}${aired.name ? ` — ${aired.name}` : ""}`,
          url: "/",
          tag: `episode-${tmdbId}`,
        },
        { sender: deps.sender },
      );
      if (n > 0) sent++;
    } catch (err) {
      log.warn("nouvel épisode", { tmdbId, error: errorMessage(err) });
    }
  }
  if (sent) log.info("notifications « nouvel épisode » envoyées", { count: sent });
  return sent;
}

/** « C'est ton tour » : appelé quand un utilisateur sort de la file d'attente. */
export async function notifyQueueServed(
  userId: string,
  platform: PlatformId,
  deps: { sender?: PushSender } = {},
): Promise<void> {
  const [u] = await getDb()
    .select({ notifyQueue: users.notifyQueue })
    .from(users)
    .where(eq(users.id, userId));
  if (!u?.notifyQueue) return;
  await sendToUser(
    userId,
    {
      title: "C'est ton tour !",
      body: `Ton navigateur ${PLATFORMS[platform].name} est prêt.`,
      url: `/watch/${platform}`,
      tag: "queue",
    },
    { sender: deps.sender },
  );
}
