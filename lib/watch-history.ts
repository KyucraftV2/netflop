import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { watchProgress, watchSamples, type WatchProgress } from "./db/schema";
import { errorMessage, logger } from "./log";
import type { PlatformId } from "./platforms";
import { nextEpisode, titleDetails, type MediaType } from "./tmdb";
import { STARTED_SECONDS } from "./tracker/progress";
import { removeWatchedMovie } from "./watchlist";

/**
 * Lecture et édition de l'historique. TOUTES les requêtes sont filtrées par userId :
 * chaque utilisateur ne voit et ne modifie que son propre historique.
 */

const log = logger("history");

export interface ContinueCard {
  progressId: number;
  kind: "resume" | "next";
  tmdbId: number;
  type: MediaType;
  title: string;
  season: number | null;
  episode: number | null;
  platform: PlatformId;
  posterPath: string | null;
  backdropPath: string | null;
  percent: number;
  resumeUrl: string | null;
  lastWatchedAt: Date;
}

function toCard(r: WatchProgress, kind: ContinueCard["kind"]): ContinueCard {
  const tv = r.type === "tv";
  return {
    progressId: r.id,
    kind,
    tmdbId: r.tmdbId!,
    type: (r.type ?? "movie") as MediaType,
    title: r.title,
    season: tv ? r.season : null,
    episode: tv ? r.episode : null,
    platform: r.platform,
    posterPath: r.posterPath,
    backdropPath: r.backdropPath,
    percent: r.percent,
    resumeUrl: r.resumeUrl,
    lastWatchedAt: r.lastWatchedAt,
  };
}

/**
 * « Continuer à regarder » : films/épisodes commencés (> 2 min) et non terminés, puis
 * l'épisode suivant des séries dont le dernier épisode vu est terminé.
 */
export async function continueWatching(userId: string, limit = 20): Promise<ContinueCard[]> {
  const db = getDb();
  const started = await db
    .select()
    .from(watchProgress)
    .where(
      and(
        eq(watchProgress.userId, userId),
        isNull(watchProgress.dismissedAt),
        eq(watchProgress.needsReview, false),
        isNotNull(watchProgress.tmdbId),
        eq(watchProgress.completed, false),
        gte(watchProgress.position, STARTED_SECONDS),
      ),
    )
    .orderBy(desc(watchProgress.lastWatchedAt))
    .limit(limit);

  // Dernier épisode vu de chaque série (DISTINCT ON).
  const latestPerSeries = await db
    .selectDistinctOn([watchProgress.tmdbId])
    .from(watchProgress)
    .where(
      and(
        eq(watchProgress.userId, userId),
        eq(watchProgress.type, "tv"),
        isNotNull(watchProgress.tmdbId),
        eq(watchProgress.needsReview, false),
      ),
    )
    .orderBy(watchProgress.tmdbId, desc(watchProgress.lastWatchedAt));

  const inProgressSeries = new Set(started.filter((s) => s.type === "tv").map((s) => s.tmdbId));
  const nextCards: ContinueCard[] = [];
  for (const last of latestPerSeries) {
    if (!last.completed || last.dismissedAt || inProgressSeries.has(last.tmdbId)) continue;
    try {
      const next = await nextEpisode(last.tmdbId!, last.season || 1, last.episode || 0);
      if (!next) continue;
      nextCards.push({
        ...toCard(last, "next"),
        season: next.season,
        episode: next.episode,
        percent: 0,
        resumeUrl: null,
      });
    } catch (err) {
      log.warn("épisode suivant indisponible", { tmdbId: last.tmdbId, error: errorMessage(err) });
    }
  }

  return [...started.map((r) => toCard(r, "resume")), ...nextCards]
    .sort((a, b) => b.lastWatchedAt.getTime() - a.lastWatchedAt.getTime())
    .slice(0, limit);
}

export async function historyFor(userId: string, platform?: PlatformId) {
  const where = [eq(watchProgress.userId, userId), eq(watchProgress.needsReview, false)];
  if (platform) where.push(eq(watchProgress.platform, platform));
  return getDb()
    .select()
    .from(watchProgress)
    .where(and(...where))
    .orderBy(desc(watchProgress.lastWatchedAt))
    .limit(300);
}

export async function toConfirmFor(userId: string) {
  return getDb()
    .select()
    .from(watchProgress)
    .where(and(eq(watchProgress.userId, userId), eq(watchProgress.needsReview, true)))
    .orderBy(desc(watchProgress.lastWatchedAt))
    .limit(100);
}

export async function dismissFromContinue(userId: string, id: number): Promise<void> {
  await getDb()
    .update(watchProgress)
    .set({ dismissedAt: new Date() })
    .where(and(eq(watchProgress.id, id), eq(watchProgress.userId, userId)));
}

export async function deleteProgress(userId: string, id: number): Promise<void> {
  await getDb()
    .delete(watchProgress)
    .where(and(eq(watchProgress.id, id), eq(watchProgress.userId, userId)));
}

export async function setWatched(userId: string, id: number, watched: boolean): Promise<void> {
  const [row] = await getDb()
    .update(watchProgress)
    .set(
      watched
        ? { completed: true, manual: true, percent: 1 }
        : { completed: false, manual: true, percent: 0, position: 0 },
    )
    .where(and(eq(watchProgress.id, id), eq(watchProgress.userId, userId)))
    .returning({ tmdbId: watchProgress.tmdbId, type: watchProgress.type });
  if (watched && row?.tmdbId && row.type === "movie") await removeWatchedMovie(userId, row.tmdbId);
}

/** Corrige l'identification d'une entrée « à confirmer » (fusion si l'œuvre existe déjà). */
export async function confirmIdentification(
  userId: string,
  id: number,
  pick: { tmdbId: number; type: MediaType; season?: number; episode?: number },
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(watchProgress)
    .where(and(eq(watchProgress.id, id), eq(watchProgress.userId, userId)));
  if (!row) return;
  const d = await titleDetails(pick.type, pick.tmdbId);
  const season = pick.type === "tv" ? (pick.season ?? (row.season || 1)) : 0;
  const episode = pick.type === "tv" ? (pick.episode ?? row.episode) : 0;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(watchProgress)
      .where(
        and(
          eq(watchProgress.userId, userId),
          eq(watchProgress.tmdbId, pick.tmdbId),
          eq(watchProgress.season, season),
          eq(watchProgress.episode, episode),
        ),
      );
    if (existing && existing.id !== row.id) {
      await tx
        .update(watchProgress)
        .set({
          position: sql`greatest(${watchProgress.position}, ${row.position})`,
          percent: sql`greatest(${watchProgress.percent}, ${row.percent})`,
          completed: sql`${watchProgress.completed} or ${row.completed}`,
          lastWatchedAt: sql`greatest(${watchProgress.lastWatchedAt}, ${row.lastWatchedAt})`,
          resumeUrl: row.resumeUrl ?? existing.resumeUrl,
        })
        .where(eq(watchProgress.id, existing.id));
      await tx.delete(watchProgress).where(eq(watchProgress.id, row.id));
      return;
    }
    await tx
      .update(watchProgress)
      .set({
        tmdbId: pick.tmdbId,
        type: pick.type,
        season,
        episode,
        title: d.title,
        posterPath: d.posterPath,
        backdropPath: d.backdropPath,
        confidence: 1,
        needsReview: false,
      })
      .where(eq(watchProgress.id, row.id));
  });
}

export async function deleteAllHistory(userId: string): Promise<void> {
  const db = getDb();
  await db.delete(watchProgress).where(eq(watchProgress.userId, userId));
  await db.delete(watchSamples).where(eq(watchSamples.userId, userId));
  log.info("historique supprimé par l'utilisateur", {});
}
