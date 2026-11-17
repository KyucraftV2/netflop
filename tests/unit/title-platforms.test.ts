import { afterEach, describe, expect, it, vi } from "vitest";

// Pas de base ni de réseau : cache transparent et faux TMDB.
vi.mock("@/lib/cache", () => ({ cached: (_k: string, _t: number, fn: () => unknown) => fn() }));

const providers = [
  { provider_id: 8, provider_name: "Netflix" },
  { provider_id: 234, provider_name: "Arte" },
  { provider_id: 1754, provider_name: "TF1+" },
  { provider_id: 2, provider_name: "Apple TV" },
];

function fakeTmdb(fr: Record<string, unknown[]>) {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const body = url.pathname.includes("/watch/providers/")
      ? { results: providers }
      : { id: 1, results: { FR: fr } };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

describe("titlePlatforms", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env.NETFLOP_PLATFORMS;
  });

  it("abonnement + gratuit (free, ads), sans achat ni location", async () => {
    process.env.TMDB_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      fakeTmdb({
        flatrate: [{ provider_id: 8, provider_name: "Netflix" }],
        free: [{ provider_id: 234, provider_name: "Arte" }],
        ads: [{ provider_id: 1754, provider_name: "TF1+" }],
        buy: [{ provider_id: 2, provider_name: "Apple TV" }],
      }),
    );
    const { titlePlatforms } = await import("@/lib/tmdb");
    expect((await titlePlatforms("movie", 1)).sort()).toEqual(["arte", "netflix", "tf1plus"]);
  });

  it("ignore les plateformes désactivées", async () => {
    process.env.TMDB_API_KEY = "test";
    process.env.NETFLOP_PLATFORMS = "netflix";
    vi.stubGlobal(
      "fetch",
      fakeTmdb({
        flatrate: [{ provider_id: 8, provider_name: "Netflix" }],
        free: [{ provider_id: 234, provider_name: "Arte" }],
      }),
    );
    const { titlePlatforms } = await import("@/lib/tmdb");
    expect(await titlePlatforms("tv", 2)).toEqual(["netflix"]);
  });
});
