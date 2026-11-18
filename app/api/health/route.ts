import { deepHealth } from "@/lib/health";
import { hasOpsToken } from "@/lib/ops-token";

export const dynamic = "force-dynamic";

/**
 * Sonde de santé.
 *  - sans paramètre : le hub répond (healthcheck Docker, aucun accès externe) ;
 *  - ?deep=1 avec `Authorization: Bearer <METRICS_TOKEN>` : base, docker-proxy, TMDB
 *    (503 si la base ou docker-proxy ne répond pas), pour une sonde externe.
 */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("deep") !== "1") return Response.json({ ok: true });
  if (!hasOpsToken(req)) return Response.json({ error: "Non autorisé" }, { status: 401 });
  const h = await deepHealth();
  return Response.json(h, {
    status: h.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
