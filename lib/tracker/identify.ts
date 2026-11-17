import type { OpenedContent } from "../db/schema";
import { PLATFORMS, type PlatformId } from "../platforms";
import { parseSeasonEpisode } from "./episode";
import type { ProbeResult } from "./probe";
import { titleSimilarity } from "./similarity";

/**
 * Identification de ce qui est regardé, par ordre de priorité :
 *  a. titre ouvert depuis Netflop (tmdbId/type déjà connus), tant qu'on reste dessus ;
 *  b. métadonnées mediaSession ;
 *  c. sélecteurs DOM de la plateforme (fragiles : échec = on passe au suivant) ;
 *  d. document.title.
 */

export type Source = "opened" | "mediaSession" | "dom" | "documentTitle";

export interface Candidate {
  source: Source;
  title: string;
  episodeTitle: string | null;
  season: number | null;
  episode: number | null;
  typeHint: "movie" | "tv" | null;
  tmdbId: number | null;
}

const GENERIC = /^(netflix|canal\+?|mycanal|france\.?tv|lecture|player|lecteur|accueil)$/i;

function stripSuffixes(title: string, platform: PlatformId): string {
  let t = title;
  for (const re of PLATFORMS[platform].documentTitleSuffixes) t = t.replace(re, "");
  return t.trim();
}

function fromText(source: Source, main: string | null, extra: string | null): Candidate | null {
  const raw = [main, extra].filter(Boolean).join(" ").trim();
  if (!raw) return null;
  const se = parseSeasonEpisode(raw);
  // Le titre de l'œuvre est la partie principale débarrassée du marquage S/É.
  const mainParsed = parseSeasonEpisode(main ?? "");
  const title = (mainParsed.rest || se.rest).trim();
  if (!title || GENERIC.test(title)) return null;
  const extraParsed = extra ? parseSeasonEpisode(extra) : null;
  const episodeTitle = extraParsed?.rest && extraParsed.rest !== title ? extraParsed.rest : null;
  return {
    source,
    title,
    episodeTitle,
    season: se.season,
    episode: se.episode,
    typeHint: se.episode !== null ? "tv" : null,
    tmdbId: null,
  };
}

export function identify(params: {
  platform: PlatformId;
  probe: ProbeResult;
  opened: OpenedContent | null;
}): Candidate | null {
  const { platform, probe, opened } = params;

  const media = probe.media?.title
    ? fromText(
        "mediaSession",
        probe.media.title,
        [probe.media.artist, probe.media.album].filter(Boolean).join(" ") || null,
      )
    : null;
  // mediaSession : souvent « titre d'épisode » + artist = série → on teste les deux sens.
  const mediaSeries =
    probe.media?.artist && probe.media.title
      ? fromText("mediaSession", probe.media.artist, probe.media.title)
      : null;
  const dom = fromText("dom", probe.dom.title, probe.dom.episode);
  const doc = fromText("documentTitle", stripSuffixes(probe.title, platform), null);
  const detected = media ?? dom ?? doc;

  if (opened?.tmdbId && opened.type && opened.platform === platform && opened.title) {
    // Le titre ouvert reste valable tant que ce qui est détecté lui ressemble (ou rien de détecté).
    const best = [media, mediaSeries, dom, doc]
      .filter((c): c is Candidate => c !== null)
      .reduce((m, c) => Math.max(m, titleSimilarity(c.title, opened.title!)), 0);
    const nothingDetected = !media && !dom && !doc;
    if (nothingDetected || best >= 0.5) {
      const se = [dom, media, mediaSeries, doc].find(
        (c) => c?.episode !== null && c?.episode !== undefined,
      );
      return {
        source: "opened",
        title: opened.title,
        episodeTitle: se?.episodeTitle ?? null,
        season: opened.type === "tv" ? (se?.season ?? opened.season ?? 1) : null,
        episode: opened.type === "tv" ? (se?.episode ?? opened.episode ?? null) : null,
        typeHint: opened.type,
        tmdbId: opened.tmdbId,
      };
    }
  }

  // Une série détectée via artist (mediaSession) est préférée si le titre est un épisode.
  if (media && mediaSeries && media.episode === null && mediaSeries.episode !== null)
    return mediaSeries;
  return detected;
}
