import { describe, expect, it } from "vitest";
import { parseSeasonEpisode } from "@/lib/tracker/episode";

describe("parseSeasonEpisode", () => {
  it.each([
    ["S1:E3", 1, 3],
    ["S1:É3", 1, 3],
    ["s01e03", 1, 3],
    ["S01E03 - Pilote", 1, 3],
    ["S1 E3", 1, 3],
    ["S2 · É4", 2, 4],
    ["S10.E12", 10, 12],
    ["Saison 1 Épisode 3", 1, 3],
    ["Saison 1, épisode 3", 1, 3],
    ["saison 5 - Épisode 112", 5, 112],
    ["Season 2 Episode 10", 2, 10],
    ["Lupin S3:É7 « Le dernier tour »", 3, 7],
    ["1x03", 1, 3],
    ["Épisode 3", null, 3],
    ["Ép. 3", null, 3],
    ["Ep 12 - Le retour", null, 12],
    ["Un si grand soleil - Episode du 17 novembre", null, null],
    ["Dune : Deuxième partie", null, null],
    ["Inception", null, null],
    ["", null, null],
  ])("%j → saison %s, épisode %s", (input, season, episode) => {
    const r = parseSeasonEpisode(input);
    expect(r.season).toBe(season);
    expect(r.episode).toBe(episode);
  });

  it("isole le reste du titre", () => {
    expect(parseSeasonEpisode("The Last of Us S1:E3").rest).toBe("The Last of Us");
    expect(parseSeasonEpisode("Saison 2 Épisode 1 - Le retour").rest).toBe("Le retour");
  });

  it("ne prend pas une année pour un épisode", () => {
    expect(parseSeasonEpisode("Blade Runner 2049").episode).toBeNull();
  });
});
