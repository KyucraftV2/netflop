import { createServer } from "node:http";

/** Faux TMDB pour les tests de bout en bout (aucun appel réseau réel). */

const providers = [
  { provider_id: 8, provider_name: "Netflix" },
  { provider_id: 381, provider_name: "Canal+" },
  { provider_id: 1899, provider_name: "HBO Max" },
  { provider_id: 350, provider_name: "Apple TV+" },
  { provider_id: 236, provider_name: "France TV" },
  { provider_id: 337, provider_name: "Disney Plus" },
];

const titles = [
  {
    id: 100088,
    media_type: "tv",
    name: "The Last of Us",
    original_name: "The Last of Us",
    first_air_date: "2023-01-15",
    overview: "",
    poster_path: null,
    popularity: 90,
    flatrate: [1899],
  },
  {
    id: 63333,
    media_type: "tv",
    name: "The Last Kingdom",
    original_name: "The Last Kingdom",
    first_air_date: "2015-10-10",
    overview: "",
    poster_path: null,
    popularity: 40,
    flatrate: [8],
  },
  {
    id: 576845,
    media_type: "movie",
    title: "Last Night in Soho",
    original_title: "Last Night in Soho",
    release_date: "2021-10-21",
    overview: "",
    poster_path: null,
    popularity: 20,
    flatrate: [337],
  },
  {
    id: 1399,
    media_type: "tv",
    name: "Game of Thrones",
    original_name: "Game of Thrones",
    first_air_date: "2011-04-17",
    overview: "",
    poster_path: null,
    popularity: 80,
    flatrate: [1899],
  },
  {
    id: 71912,
    media_type: "tv",
    name: "The Witcher",
    original_name: "The Witcher",
    first_air_date: "2019-12-20",
    overview: "",
    poster_path: null,
    popularity: 70,
    flatrate: [8],
  },
];

// Recommandations : The Last Kingdom → Game of Thrones (HBO Max, donc Canal+), The Witcher
// (Netflix) et Last Night in Soho (Disney+, hors abonnements : doit être écarté).
const recommended: Record<number, number[]> = { 63333: [1399, 71912, 576845] };

const port = Number(process.env.MOCK_TMDB_PORT ?? 3999);
createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const json = (body: unknown) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/health") return json({ ok: true });
  if (url.pathname.startsWith("/3/watch/providers/")) return json({ results: providers });
  if (url.pathname === "/3/search/multi") {
    const q = (url.searchParams.get("query") ?? "").toLowerCase();
    return json({
      page: 1,
      total_pages: 1,
      results: titles.filter((t) =>
        (t.name ?? t.title ?? "").toLowerCase().includes(q.split(" ").pop() ?? ""),
      ),
    });
  }
  const reco = /^\/3\/(movie|tv)\/(\d+)\/recommendations$/.exec(url.pathname);
  if (reco) {
    const ids = recommended[Number(reco[2])] ?? [];
    return json({
      page: 1,
      total_pages: 1,
      results: titles.filter((t) => ids.includes(t.id)),
    });
  }
  const wp = /^\/3\/(movie|tv)\/(\d+)\/watch\/providers$/.exec(url.pathname);
  if (wp) {
    const t = titles.find((x) => x.id === Number(wp[2]));
    const flat = (t?.flatrate ?? []).map((id) => providers.find((p) => p.provider_id === id));
    return json({ id: Number(wp[2]), results: { FR: { flatrate: flat } } });
  }
  res.statusCode = 404;
  json({ status_message: "not found" });
}).listen(port, "127.0.0.1");
