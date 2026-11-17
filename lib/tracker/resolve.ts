import { errorMessage, logger } from "../log";
import { searchByType, titleDetails, type MediaType, type TitleSummary } from "../tmdb";
import type { Candidate } from "./identify";
import { titleSimilarity } from "./similarity";

const log = logger("tracker");

/** En dessous : entrée « à confirmer » dans l'historique. */
export const CONFIDENCE_THRESHOLD = 0.6;

export interface Resolved {
  tmdbId: number;
  type: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  confidence: number;
}

/** Score d'un résultat TMDB pour un candidat (0 → 1). */
export function scoreMatch(
  candidate: Pick<Candidate, "title" | "typeHint">,
  r: Pick<TitleSummary, "title" | "originalTitle" | "type" | "popularity">,
  rank: number,
): number {
  const sim = Math.max(
    titleSimilarity(candidate.title, r.title),
    r.originalTitle ? titleSimilarity(candidate.title, r.originalTitle) : 0,
  );
  let score = sim;
  if (candidate.typeHint && candidate.typeHint !== r.type) score -= 0.3;
  if (rank === 0) score += 0.05; // TMDB classe déjà par pertinence
  if (r.popularity > 20) score += 0.03;
  return Math.max(0, Math.min(1, score));
}

export function pickBest(
  candidate: Pick<Candidate, "title" | "typeHint">,
  results: TitleSummary[],
): { result: TitleSummary; confidence: number } | null {
  let best: { result: TitleSummary; confidence: number } | null = null;
  results.forEach((r, i) => {
    const confidence = scoreMatch(candidate, r, i);
    if (!best || confidence > best.confidence) best = { result: r, confidence };
  });
  return best;
}

const memo = new Map<string, { value: Resolved | null; until: number }>();

/** Résolution TMDB (recherche titre + type) avec score de confiance. */
export async function resolveCandidate(c: Candidate): Promise<Resolved | null> {
  if (c.tmdbId && c.typeHint) {
    try {
      const d = await titleDetails(c.typeHint, c.tmdbId);
      return {
        tmdbId: c.tmdbId,
        type: c.typeHint,
        title: d.title,
        posterPath: d.posterPath,
        backdropPath: d.backdropPath,
        confidence: 1,
      };
    } catch {
      return {
        tmdbId: c.tmdbId,
        type: c.typeHint,
        title: c.title,
        posterPath: null,
        backdropPath: null,
        confidence: 1,
      };
    }
  }

  const key = `${c.typeHint ?? "?"}:${c.title.toLowerCase()}`;
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return hit.value;

  try {
    const types: MediaType[] = c.typeHint ? [c.typeHint] : ["tv", "movie"];
    const results = (await Promise.all(types.map((t) => searchByType(t, c.title)))).flatMap((r) =>
      r.slice(0, 5),
    );
    const best = pickBest(c, results);
    const value = best
      ? {
          tmdbId: best.result.tmdbId,
          type: best.result.type,
          title: best.result.title,
          posterPath: best.result.posterPath,
          backdropPath: best.result.backdropPath,
          confidence: best.confidence,
        }
      : null;
    memo.set(key, { value, until: Date.now() + 60 * 60 * 1000 });
    return value;
  } catch (err) {
    log.warn("résolution TMDB impossible", { error: errorMessage(err) });
    return null;
  }
}
