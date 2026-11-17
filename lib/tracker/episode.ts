/**
 * Extraction saison / épisode depuis un libellé de lecteur ou un titre de page.
 * Formats reconnus (insensibles à la casse et aux accents) :
 *   « S1:E3 », « S1:É3 », « S01E03 », « S1 E3 », « S2 · É4 », « 1x03 »,
 *   « Saison 1 Épisode 3 », « Saison 1, épisode 3 », « Saison 5 - Épisode 112 »,
 *   « Season 1 Episode 3 », « Épisode 3 », « Ép. 3 », « Ep 3 », « E3 » (isolé).
 */

export interface SeasonEpisode {
  season: number | null;
  episode: number | null;
  /** Le texte sans la partie saison/épisode (titre de la série ou de l'épisode). */
  rest: string;
}

const N = "(\\d{1,4})";
const E = "(?:[eé]p(?:isode|isodio)?\\.?|[eé])";

const PATTERNS: { re: RegExp; season: number | null; episode: number }[] = [
  // S01E03, S1:E3, S1 E3, S1.E3, S1-E3, S2 · É4
  {
    re: new RegExp(`\\bs(?:aison|eason)?\\s*${N}\\s*[:.\\-–·x ]?\\s*${E}\\s*${N}`, "iu"),
    season: 1,
    episode: 2,
  },
  // Saison 1 Épisode 3 / Season 1, Episode 3 / Saison 5 - Épisode 112
  {
    re: new RegExp(
      `\\b(?:saison|season|s)\\s*${N}\\s*[,:\\-–·|]?\\s*(?:${E}|episode)\\s*${N}`,
      "iu",
    ),
    season: 1,
    episode: 2,
  },
  // 1x03
  { re: new RegExp(`\\b${N}\\s*x\\s*(\\d{1,4})\\b`, "iu"), season: 1, episode: 2 },
  // Épisode 3 / Ép. 3 / Ep 3 / E3 (sans saison)
  { re: new RegExp(`(?:^|[\\s(«"'\\-–·|,:])${E}\\s*${N}(?!\\d)`, "iu"), season: null, episode: 1 },
];

function clean(s: string): string {
  return s
    .replace(/\s*[-–·|:,]\s*$/u, "")
    .replace(/^\s*[-–·|:,]\s*/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseSeasonEpisode(input: string | null | undefined): SeasonEpisode {
  const text = (input ?? "").replace(/ /g, " ").trim();
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const season = p.season === null ? null : Number(m[p.season]);
    const episode = Number(m[p.episode]);
    if (!Number.isFinite(episode) || episode <= 0 || episode > 5000) continue;
    if (season !== null && (season < 0 || season > 500)) continue;
    const rest = clean(text.slice(0, m.index) + " " + text.slice(m.index + m[0].length));
    return { season, episode, rest };
  }
  return { season: null, episode: null, rest: clean(text) };
}
