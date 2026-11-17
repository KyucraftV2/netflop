import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameEvaluation } from "@/lib/cdp";
import type { Db } from "@/lib/db";
import { watchProgress } from "@/lib/db/schema";
import type { ProbeResult } from "@/lib/tracker/probe";
import { TEST_DB_URL, createUsers, fakeDocker, resetData, setupDb, testConfig } from "./helpers";

// Faux Chrome : on contrôle ce que « voit » le tracker.
let page: FrameEvaluation<ProbeResult>[] = [];
vi.mock("@/lib/cdp", () => ({
  evaluateEverywhere: async () => page,
  navigate: async () => {},
}));
// Pas d'appel réseau TMDB : résolution simulée.
vi.mock("@/lib/tmdb", async (orig) => {
  const real = await orig<typeof import("@/lib/tmdb")>();
  const seasons = [{ season: 1, episodeCount: 5, airDate: "2021-01-08" }];
  return {
    ...real,
    nextEpisode: async (_id: number, s: number, e: number) => real.nextEpisodeFrom(seasons, s, e),
    titleDetails: async (type: "movie" | "tv", id: number) => ({
      tmdbId: id,
      type,
      title: "Lupin",
      originalTitle: "Lupin",
      year: 2021,
      overview: "",
      posterPath: "/p.jpg",
      backdropPath: "/b.jpg",
      popularity: 10,
      runtimeMinutes: null,
      seasons,
    }),
    searchByType: async () => [],
  };
});

const top = "https://www.netflix.com/watch/81000001";
function netflix(
  currentTime: number,
  opts: { duration?: number; paused?: boolean; url?: string } = {},
) {
  const url = opts.url ?? top;
  page = [
    {
      frameUrl: url,
      topUrl: url,
      value: {
        href: url,
        title: "Netflix",
        media: null,
        video: {
          currentTime,
          duration: opts.duration ?? 2700,
          paused: opts.paused ?? false,
          ended: false,
          area: 921600,
        },
        dom: { title: "Lupin", episode: "S1:É3 Chapitre 3" },
      },
    },
  ];
}

describe.skipIf(!TEST_DB_URL)("suivi de visionnage (Postgres réel, Chrome simulé)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let ids: Record<string, string>;
  let lifecycleMod: typeof import("@/lib/browser-lifecycle");
  let trackerMod: typeof import("@/lib/tracker/tracker");
  let history: typeof import("@/lib/watch-history");

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    process.env.TRAEFIK_NETWORK = "traefik";
    process.env.PUBLIC_IP = "203.0.113.10";
    process.env.SLOT_PORTS = "52000,52001,52002";
    ({ db, close } = await setupDb());
    lifecycleMod = await import("@/lib/browser-lifecycle");
    trackerMod = await import("@/lib/tracker/tracker");
    history = await import("@/lib/watch-history");
  });
  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    await close();
  });
  beforeEach(async () => {
    await resetData(db);
    await db.delete(watchProgress);
    ids = await createUsers(db, ["alice", "bob"]);
  });

  async function setup() {
    const lc = lifecycleMod.createLifecycle({
      docker: fakeDocker().client,
      config: testConfig,
      probe: async () => true,
    });
    await lc.start(ids.alice!, {
      platform: "netflix",
      opened: {
        platform: "netflix",
        url: "https://www.netflix.com/title/80994082",
        tmdbId: 96677,
        type: "tv",
        title: "Lupin",
        openedAt: new Date().toISOString(),
      },
    });
    const tracker = trackerMod.createTracker(lc);
    return { lc, tracker };
  }

  it("5 min d'un épisode ouvert depuis Netflop → « Continuer à regarder »", async () => {
    const { tracker } = await setup();
    netflix(10);
    await tracker.tick();
    netflix(310);
    await tracker.tick();
    const [row] = await db.select().from(watchProgress).where(eq(watchProgress.userId, ids.alice!));
    expect(row).toMatchObject({
      tmdbId: 96677,
      type: "tv",
      season: 1,
      episode: 3,
      needsReview: false,
      resumeUrl: top,
      completed: false,
    });
    expect(row!.position).toBe(310);
    const cards = await history.continueWatching(ids.alice!);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: "resume", season: 1, episode: 3 });
    // Cloisonnement : bob ne voit rien
    expect(await history.continueWatching(ids.bob!)).toHaveLength(0);
  });

  it("une bande-annonce en lecture auto n'est pas enregistrée", async () => {
    const { tracker } = await setup();
    netflix(5, { duration: 95 });
    await tracker.tick();
    netflix(35, { duration: 95 });
    await tracker.tick();
    expect(await db.select().from(watchProgress)).toHaveLength(0);
  });

  it("l'accueil Netflix (pas une page de lecture) n'est jamais collecté", async () => {
    const { tracker } = await setup();
    netflix(5, { url: "https://www.netflix.com/browse" });
    await tracker.tick();
    netflix(400, { url: "https://www.netflix.com/browse" });
    await tracker.tick();
    expect(await db.select().from(watchProgress)).toHaveLength(0);
  });

  it("épisode terminé → épisode suivant proposé", async () => {
    const { tracker } = await setup();
    netflix(2400);
    await tracker.tick();
    netflix(2450);
    await tracker.tick();
    const cards = await history.continueWatching(ids.alice!);
    expect(cards[0]).toMatchObject({ kind: "next", season: 1, episode: 4 });
  });

  it("dernière capture enregistrée avant l'arrêt du navigateur", async () => {
    const { lc, tracker } = await setup();
    lifecycleMod.registerLifecycleHooks({ beforeStop: (s, slug) => tracker.finalCapture(s, slug) });
    netflix(100);
    await tracker.tick();
    netflix(200);
    await tracker.tick();
    netflix(260, { paused: true });
    await lc.stopForUser(ids.alice!, "test");
    const [row] = await db.select().from(watchProgress);
    expect(row!.position).toBe(260);
    lifecycleMod.registerLifecycleHooks({ beforeStop: undefined });
  });

  it("un utilisateur ne peut pas modifier l'historique d'un autre", async () => {
    const { tracker } = await setup();
    netflix(10);
    await tracker.tick();
    netflix(310);
    await tracker.tick();
    const [row] = await db.select().from(watchProgress);
    await history.deleteProgress(ids.bob!, row!.id);
    await history.dismissFromContinue(ids.bob!, row!.id);
    const [after] = await db.select().from(watchProgress);
    expect(after).toMatchObject({ id: row!.id, dismissedAt: null });
  });
});
