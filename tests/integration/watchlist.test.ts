import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { watchProgress } from "@/lib/db/schema";
import { TEST_DB_URL, createUsers, resetData, setupDb } from "./helpers";

// Plateformes « actuelles » renvoyées par TMDB (sinon : erreur → plateformes à l'ajout).
let tmdbPlatforms: string[] | null = null;
vi.mock("@/lib/tmdb", async (orig) => {
  const real = await orig<typeof import("@/lib/tmdb")>();
  return {
    ...real,
    titlePlatforms: async () => {
      if (!tmdbPlatforms) throw new Error("TMDB indisponible");
      return tmdbPlatforms;
    },
  };
});

const dune = {
  tmdbId: 438631,
  type: "movie" as const,
  title: "Dune",
  year: 2021,
  posterPath: "/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
  platforms: ["canalplus" as const],
};
const lupin = { ...dune, tmdbId: 96677, type: "tv" as const, title: "Lupin", year: 2021 };

describe.skipIf(!TEST_DB_URL)("Ma liste (Postgres réel)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let ids: Record<string, string>;
  let wl: typeof import("@/lib/watchlist");
  let history: typeof import("@/lib/watch-history");

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    ({ db, close } = await setupDb());
    wl = await import("@/lib/watchlist");
    history = await import("@/lib/watch-history");
  });
  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    await close();
  });
  beforeEach(async () => {
    await resetData(db);
    tmdbPlatforms = null;
    ids = await createUsers(db, ["alice", "bob"]);
  });

  it("ajout idempotent, ordre du plus récent, retrait", async () => {
    expect(await wl.addToWatchlist(ids.alice!, dune)).toBe(true);
    expect(await wl.addToWatchlist(ids.alice!, lupin)).toBe(true);
    expect(await wl.addToWatchlist(ids.alice!, dune)).toBe(true);
    const list = await wl.listWatchlist(ids.alice!);
    expect(list.map((i) => i.title)).toEqual(["Lupin", "Dune"]);
    expect(await wl.watchlistKeys(ids.alice!)).toEqual(
      expect.arrayContaining(["movie-438631", "tv-96677"]),
    );

    await wl.removeFromWatchlist(ids.alice!, dune.tmdbId, "movie");
    expect((await wl.listWatchlist(ids.alice!)).map((i) => i.title)).toEqual(["Lupin"]);
  });

  it("chaque utilisateur ne voit que sa liste", async () => {
    await wl.addToWatchlist(ids.alice!, dune);
    expect(await wl.listWatchlist(ids.bob!)).toEqual([]);
    await wl.removeFromWatchlist(ids.bob!, dune.tmdbId, "movie");
    expect(await wl.listWatchlist(ids.alice!)).toHaveLength(1);
  });

  it("plateformes rafraîchies via TMDB, sinon celles connues à l'ajout", async () => {
    await wl.addToWatchlist(ids.alice!, dune);
    expect((await wl.listWatchlist(ids.alice!))[0]!.platforms).toEqual(["canalplus"]);
    tmdbPlatforms = ["netflix"];
    expect((await wl.listWatchlist(ids.alice!))[0]!.platforms).toEqual(["netflix"]);
  });

  it("limite de taille", async () => {
    for (let i = 1; i <= wl.WATCHLIST_MAX; i++) {
      await wl.addToWatchlist(ids.alice!, { ...dune, tmdbId: i });
    }
    expect(await wl.addToWatchlist(ids.alice!, { ...dune, tmdbId: 999_999 })).toBe(false);
  });

  it("un film marqué comme vu sort de la liste, pas une série", async () => {
    await wl.addToWatchlist(ids.alice!, dune);
    await wl.addToWatchlist(ids.alice!, lupin);
    const [movie, episode] = await db
      .insert(watchProgress)
      .values([
        {
          userId: ids.alice!,
          tmdbId: dune.tmdbId,
          type: "movie",
          platform: "canalplus",
          title: "Dune",
        },
        {
          userId: ids.alice!,
          tmdbId: lupin.tmdbId,
          type: "tv",
          season: 1,
          episode: 1,
          platform: "netflix",
          title: "Lupin",
        },
      ])
      .returning();
    await history.setWatched(ids.alice!, episode!.id, true);
    await history.setWatched(ids.alice!, movie!.id, true);
    expect((await wl.listWatchlist(ids.alice!)).map((i) => i.title)).toEqual(["Lupin"]);
  });
});
