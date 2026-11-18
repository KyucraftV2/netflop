import { describe, expect, it } from "vitest";
import { rankCandidates } from "@/lib/recommendations";
import type { TitleSummary } from "@/lib/tmdb";

const t = (tmdbId: number, popularity = 1): TitleSummary => ({
  tmdbId,
  type: "tv",
  title: `T${tmdbId}`,
  originalTitle: null,
  year: 2020,
  overview: "",
  posterPath: null,
  backdropPath: null,
  popularity,
});

describe("rankCandidates", () => {
  it("favorise les titres recommandés par plusieurs sources et les sources récentes", () => {
    const ranked = rankCandidates(
      [
        [t(1), t(2), t(3)], // source la plus récente
        [t(3), t(4)],
      ],
      new Set(),
    );
    expect(ranked.map((r) => r.tmdbId)).toEqual([1, 3, 2, 4]);
  });

  it("exclut les titres déjà vus ou dans Ma liste et limite le nombre", () => {
    const ranked = rankCandidates([[t(1), t(2), t(3), t(4)]], new Set(["tv-2"]), 2);
    expect(ranked.map((r) => r.tmdbId)).toEqual([1, 3]);
  });
});
