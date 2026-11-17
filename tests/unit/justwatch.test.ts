import { beforeEach, describe, expect, it } from "vitest";
import {
  justWatchEnabled,
  pickOfferUrl,
  recordJustWatchResult,
  resetJustWatchBreaker,
} from "@/lib/justwatch";

const response = {
  data: {
    popularTitles: {
      edges: [
        {
          node: {
            objectType: "SHOW",
            content: {
              title: "The Last of Us",
              originalReleaseYear: 2023,
              externalIds: { tmdbId: "100088" },
            },
            offers: [
              {
                monetizationType: "BUY",
                standardWebURL: "https://tv.apple.com/fr/show/x",
                package: { clearName: "Apple TV" },
              },
              {
                monetizationType: "FLATRATE",
                standardWebURL: "https://www.canalplus.com/series/the-last-of-us/h/123",
                package: { clearName: "Canal+" },
              },
              {
                monetizationType: "FLATRATE",
                standardWebURL: "https://evil.example/phish",
                package: { clearName: "Netflix" },
              },
            ],
          },
        },
        {
          node: {
            objectType: "MOVIE",
            content: { title: "Autre", externalIds: { tmdbId: "100088" } },
            offers: [
              {
                monetizationType: "FLATRATE",
                standardWebURL: "https://www.netflix.com/title/1",
                package: { clearName: "Netflix" },
              },
            ],
          },
        },
      ],
    },
  },
};

describe("JustWatch", () => {
  beforeEach(() => resetJustWatchBreaker());

  it("choisit l'offre flatrate de la plateforme pour le bon titre et le bon type", () => {
    expect(pickOfferUrl(response, 100088, "tv", "canalplus")).toBe(
      "https://www.canalplus.com/series/the-last-of-us/h/123",
    );
  });

  it("ignore une URL hors liste blanche", () => {
    expect(pickOfferUrl(response, 100088, "tv", "netflix")).toBeNull();
  });

  it("ne confond pas film et série de même identifiant", () => {
    expect(pickOfferUrl(response, 100088, "movie", "netflix")).toBe(
      "https://www.netflix.com/title/1",
    );
  });

  it("ignore un autre tmdbId", () => {
    expect(pickOfferUrl(response, 1, "tv", "canalplus")).toBeNull();
  });

  it("coupe-circuit après 5 erreurs, rétabli après 1 h", () => {
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) recordJustWatchResult(false, t);
    expect(justWatchEnabled(t)).toBe(true);
    recordJustWatchResult(false, t);
    expect(justWatchEnabled(t + 1000)).toBe(false);
    expect(justWatchEnabled(t + 60 * 60 * 1000 + 1)).toBe(true);
    recordJustWatchResult(true);
    expect(justWatchEnabled(t)).toBe(true);
  });

  it("désactivable par JUSTWATCH_ENABLED=false", () => {
    process.env.JUSTWATCH_ENABLED = "false";
    expect(justWatchEnabled()).toBe(false);
    delete process.env.JUSTWATCH_ENABLED;
  });
});
