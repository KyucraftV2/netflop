import { lt, sql } from "drizzle-orm";
import type { Lifecycle } from "../browser-lifecycle";
import { evaluateEverywhere, type FrameEvaluation } from "../cdp";
import { getConfig } from "../config";
import { purgeExpiredCache } from "../cache";
import { getDb } from "../db";
import { watchProgress, watchSamples, type BrowserSession } from "../db/schema";
import { errorMessage, logger } from "../log";
import { isPlaybackUrl, PLATFORMS, platformForUrl, type PlatformId } from "../platforms";
import { identify, type Candidate } from "./identify";
import { buildProbeExpression, type ProbeResult } from "./probe";
import { decide, effectivePauseMinutes, shouldStopForPause, type TrackState } from "./progress";
import { CONFIDENCE_THRESHOLD, resolveCandidate, type Resolved } from "./resolve";
import { removeWatchedMovie } from "../watchlist";

/**
 * Suivi de visionnage automatique (worker) : lit l'état du Chrome de chaque séance par
 * CDP, en lecture seule, uniquement sur les pages de LECTURE des plateformes, et en déduit
 * ce qui est regardé, où on en est et ce qui est fini.
 */

const log = logger("tracker");
const SAMPLE_RETENTION_DAYS = 30;

export interface Observation {
  platform: PlatformId;
  url: string;
  probe: ProbeResult;
}

/** Retient l'observation de la page de lecture : URL du haut + frame à la plus grande vidéo. */
export function pickObservation(evals: FrameEvaluation<ProbeResult>[]): Observation | null {
  const top = evals[0];
  if (!top) return null;
  const platform = platformForUrl(top.topUrl);
  if (!platform || !isPlaybackUrl(platform, top.topUrl)) return null;
  const withVideo = evals
    .filter((e) => e.value.video)
    .sort((a, b) => (b.value.video?.area ?? 0) - (a.value.video?.area ?? 0))[0];
  const topProbe = evals.find((e) => e.frameUrl === e.topUrl)?.value ?? top.value;
  const src = withVideo?.value ?? topProbe;
  return {
    platform,
    url: top.topUrl,
    probe: {
      href: top.topUrl,
      title: topProbe.title || src.title,
      media: src.media ?? topProbe.media,
      video: withVideo?.value.video ?? null,
      dom: {
        title: src.dom.title ?? topProbe.dom.title,
        episode: src.dom.episode ?? topProbe.dom.episode,
      },
    },
  };
}

export function contentKeyOf(c: Candidate): string {
  return `${c.tmdbId ?? c.title.toLowerCase()}|${c.season ?? 0}|${c.episode ?? 0}`;
}

export function createTracker(lc: Lifecycle) {
  const states = new Map<string, TrackState>(); // par id de session
  let lastPurge = 0;

  async function observe(session: BrowserSession): Promise<Observation | null> {
    // Sélecteurs de toutes les plateformes : on ne sait pas encore sur laquelle est l'onglet.
    const selectors = {
      title: Object.values(PLATFORMS).flatMap((p) => p.domSelectors.title ?? []),
      episode: Object.values(PLATFORMS).flatMap((p) => p.domSelectors.episode ?? []),
    };
    const evals = await evaluateEverywhere<ProbeResult>(
      session.slot,
      buildProbeExpression(selectors),
      { timeoutMs: 4_000 },
    );
    return pickObservation(evals);
  }

  async function writeProgress(
    session: BrowserSession,
    obs: Observation,
    c: Candidate,
    r: Resolved | null,
    completed: boolean,
    percent: number,
  ) {
    const db = getDb();
    const video = obs.probe.video!;
    const confident = r !== null && r.confidence >= CONFIDENCE_THRESHOLD;
    const isTv = (r?.type ?? c.typeHint) === "tv" || c.episode !== null;
    const values = {
      userId: session.userId,
      tmdbId: r?.tmdbId ?? null,
      type: r?.type ?? c.typeHint,
      season: isTv ? (c.season ?? 1) : 0,
      episode: isTv ? (c.episode ?? 0) : 0,
      platform: obs.platform,
      title: r?.title ?? c.title,
      rawTitle: c.title,
      episodeTitle: c.episodeTitle,
      posterPath: r?.posterPath ?? null,
      backdropPath: r?.backdropPath ?? null,
      resumeUrl: obs.url,
      position: video.currentTime,
      duration: video.duration,
      percent,
      completed,
      confidence: r?.confidence ?? 0,
      needsReview: !confident,
      dismissedAt: null,
      lastWatchedAt: new Date(),
    };
    const set = {
      resumeUrl: values.resumeUrl,
      position: values.position,
      duration: values.duration,
      percent: values.percent,
      // « terminé » reste acquis (un retour au générique ne le défait pas)
      completed: sql`${watchProgress.completed} or ${completed}`,
      platform: values.platform,
      episodeTitle: values.episodeTitle,
      dismissedAt: null,
      lastWatchedAt: values.lastWatchedAt,
      manual: false,
    };
    if (values.tmdbId !== null) {
      await db
        .insert(watchProgress)
        .values(values)
        .onConflictDoUpdate({
          target: [
            watchProgress.userId,
            watchProgress.tmdbId,
            watchProgress.season,
            watchProgress.episode,
          ],
          targetWhere: sql`${watchProgress.tmdbId} is not null`,
          set,
        });
    } else {
      await db
        .insert(watchProgress)
        .values(values)
        .onConflictDoUpdate({
          target: [
            watchProgress.userId,
            watchProgress.platform,
            watchProgress.rawTitle,
            watchProgress.season,
            watchProgress.episode,
          ],
          targetWhere: sql`${watchProgress.tmdbId} is null`,
          set,
        });
    }
    // Film terminé : il sort de « Ma liste ».
    if (completed && values.tmdbId !== null && values.type === "movie") {
      await removeWatchedMovie(session.userId, values.tmdbId);
    }
  }

  /** Un échantillon pour une séance. `final` : dernière capture avant arrêt. */
  async function sample(
    session: BrowserSession,
    slug: string,
    opts: { final?: boolean; pausedStopMinutes?: number | null } = {},
  ): Promise<{ stopForPause: boolean; stopForSleep: boolean }> {
    const now = Date.now();
    const obs = await observe(session);
    const prev = states.get(session.id);
    if (!obs) {
      states.set(session.id, decide(prev, "∅", null, now).next);
      return { stopForPause: false, stopForSleep: false };
    }

    const c = identify({
      platform: obs.platform,
      probe: obs.probe,
      opened: session.openedContent ?? null,
    });
    const key = c ? contentKeyOf(c) : `url:${obs.url}`;
    const d = decide(prev, key, obs.probe.video, now);
    states.set(session.id, d.next);

    // Données brutes (purgées après 30 jours) : pages de lecture uniquement.
    await getDb()
      .insert(watchSamples)
      .values({
        userId: session.userId,
        platform: obs.platform,
        url: obs.url,
        rawTitle: c?.title ?? null,
        position: obs.probe.video?.currentTime ?? null,
        duration: obs.probe.video?.duration ?? null,
        paused: obs.probe.video?.paused ?? null,
      });

    const record =
      d.record || (opts.final === true && d.next.hasProgressed && obs.probe.video !== null);
    if (record && c && obs.probe.video && obs.probe.video.duration >= 180) {
      const r = await resolveCandidate(c);
      await writeProgress(session, obs, c, r, d.completed, d.percent);
      log.debug("progression", {
        user: slug,
        platform: obs.platform,
        percent: Math.round(d.percent * 100),
      });
    }

    return {
      stopForPause:
        !opts.final &&
        shouldStopForPause(
          d.next,
          now,
          effectivePauseMinutes(opts.pausedStopMinutes, getConfig().PAUSED_STOP_MINUTES),
        ),
      // Minuteur « fin de l'épisode » : le contenu en cours vient d'être terminé.
      stopForSleep:
        !opts.final && session.sleepAfterEpisode && d.completed && obs.probe.video !== null,
    };
  }

  /** Une passe sur toutes les séances prêtes. */
  async function tick(): Promise<void> {
    const sessions = await lc.activeSessions();
    const alive = new Set<string>();
    for (const { session, slug, pausedStopMinutes } of sessions) {
      alive.add(session.id);
      if (session.status !== "ready") continue;
      try {
        const { stopForPause, stopForSleep } = await sample(session, slug, { pausedStopMinutes });
        if (stopForSleep) {
          log.info("minuteur : fin de l'épisode, arrêt du navigateur", { user: slug });
          await lc.stopSession(session, slug, "minuteur de sommeil (fin de l'épisode)");
        } else if (stopForPause) {
          log.info("pause prolongée : arrêt du navigateur", { user: slug });
          await lc.stopSession(session, slug, "pause prolongée");
        }
      } catch (err) {
        log.debug("échantillon impossible", { user: slug, error: errorMessage(err) });
      }
    }
    for (const id of states.keys()) if (!alive.has(id)) states.delete(id);

    if (Date.now() - lastPurge > 60 * 60 * 1000) {
      lastPurge = Date.now();
      const cutoff = new Date(Date.now() - SAMPLE_RETENTION_DAYS * 86_400_000);
      const purged = await getDb()
        .delete(watchSamples)
        .where(lt(watchSamples.capturedAt, cutoff))
        .returning({ id: watchSamples.id });
      if (purged.length) log.info("échantillons purgés", { count: purged.length });
      const cachePurged = await purgeExpiredCache();
      if (cachePurged) log.info("cache API expiré purgé", { count: cachePurged });
    }
  }

  /** Hook beforeStop : la progression est enregistrée une dernière fois avant tout arrêt. */
  async function finalCapture(session: BrowserSession, slug: string): Promise<void> {
    if (session.status !== "ready" && session.status !== "stopping") return;
    await sample(session, slug, { final: true });
    states.delete(session.id);
  }

  return { tick, sample, finalCapture };
}

export type Tracker = ReturnType<typeof createTracker>;
