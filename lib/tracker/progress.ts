import type { ProbeVideo } from "./probe";

/** Vidéos plus courtes ignorées (bandes-annonces, aperçus de l'accueil). */
export const MIN_DURATION_SECONDS = 180;
/** « Commencé » pour « Continuer à regarder ». */
export const STARTED_SECONDS = 120;
export const COMPLETED_RATIO = 0.9;

export interface TrackState {
  contentKey: string;
  lastPosition: number;
  lastAt: number;
  /** La vidéo de ce contenu a réellement progressé au moins une fois. */
  hasProgressed: boolean;
  lastProgressAt: number;
  pausedSince: number | null;
}

export interface Decision {
  /** Écrire la progression maintenant. */
  record: boolean;
  completed: boolean;
  percent: number;
  reason: "no-video" | "too-short" | "new-content" | "progressing" | "ended" | "idle" | "paused";
  next: TrackState;
}

/**
 * Décide si un échantillon reflète une vraie progression : la position avance (vidéo non
 * en pause) entre deux échantillons du même contenu, ou la vidéo est terminée. Évite les
 * faux positifs (bande-annonce en lecture auto, aperçus).
 */
export function decide(
  prev: TrackState | undefined,
  contentKey: string,
  video: ProbeVideo | null,
  now: number,
): Decision {
  const base: TrackState =
    prev && prev.contentKey === contentKey
      ? prev
      : {
          contentKey,
          lastPosition: video?.currentTime ?? 0,
          lastAt: now,
          hasProgressed: false,
          lastProgressAt: prev?.lastProgressAt ?? now,
          pausedSince: null,
        };

  if (!video) {
    return {
      record: false,
      completed: false,
      percent: 0,
      reason: "no-video",
      next: { ...base, pausedSince: null },
    };
  }
  const percent = video.duration > 0 ? Math.min(1, video.currentTime / video.duration) : 0;
  const completed = video.ended || percent >= COMPLETED_RATIO;
  const pausedSince = video.paused ? (base.pausedSince ?? now) : null;

  if (video.duration < MIN_DURATION_SECONDS) {
    return {
      record: false,
      completed: false,
      percent,
      reason: "too-short",
      next: { ...base, pausedSince },
    };
  }

  if (!prev || prev.contentKey !== contentKey) {
    // Premier échantillon : on attend le suivant pour confirmer que ça avance.
    return {
      record: false,
      completed,
      percent,
      reason: "new-content",
      next: { ...base, lastPosition: video.currentTime, lastAt: now, pausedSince },
    };
  }

  const advanced = video.currentTime - prev.lastPosition;
  const progressing = !video.paused && advanced > 2;
  const next: TrackState = {
    ...base,
    lastPosition: video.currentTime,
    lastAt: now,
    hasProgressed: base.hasProgressed || progressing,
    lastProgressAt: progressing ? now : base.lastProgressAt,
    pausedSince,
  };
  if (video.ended && base.hasProgressed) {
    return { record: true, completed: true, percent: 1, reason: "ended", next };
  }
  if (progressing) return { record: true, completed, percent, reason: "progressing", next };
  return { record: false, completed, percent, reason: video.paused ? "paused" : "idle", next };
}

/** Pause prolongée sans aucune progression → arrêt du navigateur (économie de ressources). */
export function shouldStopForPause(
  state: TrackState | undefined,
  now: number,
  minutes: number,
): boolean {
  if (!state || state.pausedSince === null) return false;
  const limit = minutes * 60_000;
  return now - state.pausedSince >= limit && now - state.lastProgressAt >= limit;
}

/** Délai d'arrêt sur pause : choix de l'utilisateur, plafonné par la valeur de l'admin. */
export function effectivePauseMinutes(userMinutes: number | null | undefined, max: number): number {
  if (userMinutes === null || userMinutes === undefined || userMinutes <= 0) return max;
  return Math.min(userMinutes, max);
}
