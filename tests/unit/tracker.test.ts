import { describe, expect, it } from "vitest";
import { identify } from "@/lib/tracker/identify";
import type { ProbeResult } from "@/lib/tracker/probe";
import { decide, shouldStopForPause, type TrackState } from "@/lib/tracker/progress";
import { pickBest, scoreMatch } from "@/lib/tracker/resolve";
import { titleSimilarity } from "@/lib/tracker/similarity";
import { pickObservation } from "@/lib/tracker/tracker";

const video = (currentTime: number, duration = 3000, paused = false, ended = false) => ({
  currentTime,
  duration,
  paused,
  ended,
  area: 1280 * 720,
});

describe("décision de progression", () => {
  it("premier échantillon : on attend confirmation", () => {
    const d = decide(undefined, "k", video(100), 0);
    expect(d.record).toBe(false);
    expect(d.reason).toBe("new-content");
  });

  it("enregistre quand la vidéo avance réellement", () => {
    let s = decide(undefined, "k", video(100), 0).next;
    const d = decide(s, "k", video(130), 30_000);
    expect(d.record).toBe(true);
    expect(d.reason).toBe("progressing");
    s = d.next;
    expect(s.hasProgressed).toBe(true);
  });

  it("ignore une bande-annonce (< 3 min) même en lecture", () => {
    const s = decide(undefined, "trailer", video(10, 120), 0).next;
    const d = decide(s, "trailer", video(40, 120), 30_000);
    expect(d.record).toBe(false);
    expect(d.reason).toBe("too-short");
  });

  it("n'enregistre pas une vidéo en pause", () => {
    const s = decide(undefined, "k", video(100, 3000, true), 0).next;
    const d = decide(s, "k", video(100, 3000, true), 30_000);
    expect(d.record).toBe(false);
    expect(d.reason).toBe("paused");
  });

  it("terminé à 90 % ou à la fin de la vidéo", () => {
    let s = decide(undefined, "k", video(2680), 0).next;
    let d = decide(s, "k", video(2710), 30_000);
    expect(d.completed).toBe(true);
    s = decide(undefined, "k2", video(100), 0).next;
    s = decide(s, "k2", video(130), 30_000).next;
    d = decide(s, "k2", video(130, 3000, true, true), 60_000);
    expect(d).toMatchObject({ record: true, completed: true, reason: "ended" });
  });

  it("changement de contenu : on repart de zéro", () => {
    const s = decide(undefined, "a", video(100), 0).next;
    const d = decide(s, "b", video(5), 30_000);
    expect(d.reason).toBe("new-content");
    expect(d.record).toBe(false);
  });

  it("pause prolongée sans progression → arrêt", () => {
    const st: TrackState = {
      contentKey: "k",
      lastPosition: 10,
      lastAt: 0,
      hasProgressed: true,
      lastProgressAt: 0,
      pausedSince: 0,
    };
    expect(shouldStopForPause(st, 29 * 60_000, 30)).toBe(false);
    expect(shouldStopForPause(st, 30 * 60_000, 30)).toBe(true);
    expect(shouldStopForPause({ ...st, pausedSince: null }, 60 * 60_000, 30)).toBe(false);
    expect(shouldStopForPause({ ...st, lastProgressAt: 10 * 60_000 }, 30 * 60_000, 30)).toBe(false);
  });
});

const probe = (p: Partial<ProbeResult>): ProbeResult => ({
  href: "https://www.netflix.com/watch/1",
  title: "Netflix",
  media: null,
  video: video(100),
  dom: { title: null, episode: null },
  ...p,
});

describe("identification", () => {
  it("priorité au titre ouvert depuis Netflop, épisode depuis le DOM", () => {
    const c = identify({
      platform: "netflix",
      probe: probe({ dom: { title: "Lupin", episode: "S3:É7 Le dernier tour" } }),
      opened: {
        platform: "netflix",
        url: "https://www.netflix.com/title/80994082",
        tmdbId: 96677,
        type: "tv",
        title: "Lupin",
        openedAt: new Date().toISOString(),
      },
    });
    expect(c).toMatchObject({ source: "opened", tmdbId: 96677, season: 3, episode: 7 });
  });

  it("abandonne le titre ouvert si on regarde autre chose", () => {
    const c = identify({
      platform: "netflix",
      probe: probe({ dom: { title: "Stranger Things", episode: "S1:É1" } }),
      opened: {
        platform: "netflix",
        url: "https://www.netflix.com/title/1",
        tmdbId: 96677,
        type: "tv",
        title: "Lupin",
        openedAt: new Date().toISOString(),
      },
    });
    expect(c).toMatchObject({
      source: "dom",
      title: "Stranger Things",
      season: 1,
      episode: 1,
      tmdbId: null,
    });
  });

  it("mediaSession avant le DOM", () => {
    const c = identify({
      platform: "canalplus",
      probe: probe({
        media: { title: "The Last of Us", artist: "Saison 1 Épisode 3", album: "" },
        dom: { title: "Autre", episode: null },
      }),
      opened: null,
    });
    expect(c).toMatchObject({
      source: "mediaSession",
      title: "The Last of Us",
      season: 1,
      episode: 3,
    });
  });

  it("document.title en dernier recours, sans le suffixe de la plateforme", () => {
    const c = identify({
      platform: "francetv",
      probe: probe({ title: "Un si grand soleil - Saison 5 Épisode 112 - france.tv" }),
      opened: null,
    });
    expect(c).toMatchObject({
      source: "documentTitle",
      title: "Un si grand soleil",
      season: 5,
      episode: 112,
    });
  });

  it("titre générique ignoré", () => {
    expect(
      identify({ platform: "netflix", probe: probe({ title: "Netflix" }), opened: null }),
    ).toBeNull();
  });
});

describe("score de confiance TMDB", () => {
  it("similarité de titres", () => {
    expect(titleSimilarity("The Last of Us", "the last of us")).toBe(1);
    expect(titleSimilarity("Lupin", "Lupin : Dans l'ombre d'Arsène")).toBeGreaterThan(0.3);
    expect(titleSimilarity("Dune", "Inception")).toBeLessThan(0.2);
  });

  it("pénalise un type incohérent", () => {
    const r = { title: "Dune", originalTitle: "Dune", type: "movie" as const, popularity: 50 };
    expect(scoreMatch({ title: "Dune", typeHint: "tv" }, r, 0)).toBeLessThan(
      scoreMatch({ title: "Dune", typeHint: "movie" }, r, 0),
    );
  });

  it("confiance faible pour un titre ambigu", () => {
    const best = pickBest({ title: "Le Bureau", typeHint: null }, [
      {
        tmdbId: 1,
        type: "tv",
        title: "Le Bureau des Légendes",
        originalTitle: null,
        year: 2015,
        overview: "",
        posterPath: null,
        backdropPath: null,
        popularity: 10,
      },
    ]);
    expect(best!.confidence).toBeLessThan(0.6);
  });
});

describe("choix de l'observation", () => {
  it("ignore les pages qui ne sont pas des pages de lecture (accueil Netflix)", () => {
    expect(
      pickObservation([
        {
          frameUrl: "https://www.netflix.com/browse",
          topUrl: "https://www.netflix.com/browse",
          value: probe({}),
        },
      ]),
    ).toBeNull();
  });

  it("prend la plus grande vidéo, y compris dans une iframe", () => {
    const top = "https://www.france.tv/france-2/serie/saison-1/123456-episode-1.html";
    const obs = pickObservation([
      { frameUrl: top, topUrl: top, value: probe({ title: "Série - france.tv", video: null }) },
      {
        frameUrl: "https://player.ftven.fr/",
        topUrl: top,
        value: probe({ video: { ...video(500), area: 999_999 } }),
      },
    ]);
    expect(obs?.platform).toBe("francetv");
    expect(obs?.probe.video?.currentTime).toBe(500);
    expect(obs?.probe.title).toBe("Série - france.tv");
  });
});

describe("préférences de lecture", () => {
  it("délai de pause : choix de l'utilisateur plafonné par l'admin", async () => {
    const { effectivePauseMinutes } = await import("@/lib/tracker/progress");
    expect(effectivePauseMinutes(null, 30)).toBe(30);
    expect(effectivePauseMinutes(10, 30)).toBe(10);
    expect(effectivePauseMinutes(120, 30)).toBe(30);
    expect(effectivePauseMinutes(0, 30)).toBe(30);
  });

  it("qualité « auto »", async () => {
    const { resolveQuality } = await import("@/lib/browser-spec");
    expect(resolveQuality("normal", "saver")).toBe("normal");
    expect(resolveQuality("saver", null)).toBe("saver");
    expect(resolveQuality("auto", null)).toBe("normal");
    expect(resolveQuality("auto", "saver")).toBe("saver");
  });
});
