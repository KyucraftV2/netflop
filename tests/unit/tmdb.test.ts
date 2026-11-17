import { describe, expect, it } from "vitest";
import { nextEpisodeFrom, toSummary } from "@/lib/tmdb";

describe("toSummary", () => {
  it("film", () => {
    expect(
      toSummary({
        id: 1,
        media_type: "movie",
        title: "Dune",
        original_title: "Dune",
        release_date: "2021-09-15",
        overview: "",
        poster_path: "/p.jpg",
        popularity: 3,
      }),
    ).toMatchObject({ tmdbId: 1, type: "movie", title: "Dune", year: 2021, posterPath: "/p.jpg" });
  });
  it("série", () => {
    expect(
      toSummary({
        id: 2,
        media_type: "tv",
        name: "Lupin",
        first_air_date: "2021-01-08",
        overview: "",
        popularity: 1,
      }),
    ).toMatchObject({ type: "tv", title: "Lupin", year: 2021 });
  });
  it("ignore les personnes", () => {
    expect(
      toSummary({ id: 3, media_type: "person", name: "X", overview: "", popularity: 0 }),
    ).toBeNull();
  });
});

describe("épisode suivant", () => {
  const seasons = [
    { season: 0, episodeCount: 3, airDate: "2020-01-01" },
    { season: 1, episodeCount: 9, airDate: "2023-01-15" },
    { season: 2, episodeCount: 7, airDate: "2025-04-13" },
    { season: 3, episodeCount: 8, airDate: "2099-01-01" },
  ];
  const today = new Date("2026-11-17");
  it("dans la même saison", () => {
    expect(nextEpisodeFrom(seasons, 1, 3, today)).toEqual({ season: 1, episode: 4 });
  });
  it("passe à la saison suivante", () => {
    expect(nextEpisodeFrom(seasons, 1, 9, today)).toEqual({ season: 2, episode: 1 });
  });
  it("aucune saison diffusée ensuite", () => {
    expect(nextEpisodeFrom(seasons, 2, 7, today)).toBeNull();
  });
});
